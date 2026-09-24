/**
 * The export bundle: one directory per session inside its project's export
 * folder, holding `spec.md` at the top, `decisions.md` beside it when the
 * session settled something of its own, one `issues/NN-slug.md` per ticket,
 * and a manifest of what the export wrote.
 *
 *     <project root>/<export folder>/<folder name>/HANDOFF.md        (when a handoff exists)
 *     <project root>/<export folder>/<folder name>/spec.md
 *     <project root>/<export folder>/<folder name>/decisions.md      (when anything is decided or out of scope)
 *     <project root>/<export folder>/<folder name>/issues/NN-slug.md
 *     <project root>/<export folder>/<folder name>/briefs/NN-slug.md (when a handoff exists)
 *     <project root>/<export folder>/<folder name>/.grill-room-export.json
 *
 * {@link planExportBundle} is the single source of truth for what an export
 * does. `preview-export` returns its plan without writing; `export-session`
 * builds the very same plan and hands it to {@link writeExportBundle}. The
 * preview and the write therefore cannot disagree about a path.
 *
 * ## Folder name
 *
 * The folder name is the project's slug pattern with its placeholders filled:
 *
 * - `{slug}` — the slug the operator confirmed, sanitized by `sanitizeSlug`
 *   (lowercase ASCII letters, digits and single hyphens, at most 60
 *   characters). The proposal is `proposeSlug`: the first four words of the
 *   session title. A slug that sanitizes to nothing is refused.
 * - `{date}` — today's local date as `YYYY-MM-DD`.
 * - `{seq}` — if a folder in the export folder already matches the pattern
 *   with the same slug and date (any digits standing for `{seq}`), that folder
 *   is reused, so re-exporting lands where it did last time. Otherwise one more
 *   than the highest numeric prefix among the export folder's existing
 *   folders, zero-padded to two digits (`01` when there is none).
 *
 * ## Handoff
 *
 * When the session has a generated handoff (`server/handoff.ts`), its
 * `HANDOFF.md` and briefs are planned files like the spec and tickets: listed
 * in the preview, checked for containment, and recorded in the manifest, so a
 * brief whose ticket is dropped is removed by the next export. Their
 * `{{BUNDLE}}` placeholders are filled with the bundle path — repo-relative
 * for a `tracked` project, absolute for an `ignored` one.
 *
 * ## Export gate
 *
 * `exportBlockedReason` ({@link ExportGateReason}, from `getExportGate`) is
 * `"handoff-missing"` when the session has no handoff at all, or
 * `"handoff-stale"` when one exists but no longer matches today's inputs
 * (the same fingerprint check `describeHandoff`'s `stale` makes); `null` once
 * the handoff is current. This module only reports it — `preview-export`
 * surfaces it for the UI, and `export-session` is the one that refuses to
 * write when it is non-null.
 *
 * ## Containment
 *
 * The project's export folder was checked lexically at registration; that
 * check cannot see symlinks. Here every path the export would write or remove
 * is resolved through the filesystem — `fs.realpath` on the project root and
 * on the deepest existing ancestor of each path — and the plan is refused with
 * `export-outside-root` unless every one lands strictly inside the real project
 * root. A dangling symlink on the way is refused too, since writing through it
 * would create its target wherever it points.
 *
 * ## Manifest and re-export
 *
 * Every export writes `.grill-room-export.json` (`EXPORT_MANIFEST_FILE`) at
 * the top of the bundle, listing the relative paths of every other file it
 * wrote. The manifest is a planned file like any other: it appears in the
 * preview's file list and passes the same containment check.
 *
 * Writing overwrites every planned file. It removes exactly the paths the
 * bundle's previous manifest lists that the new plan no longer contains and
 * that still exist, such as a ticket dropped since the last export. Nothing
 * the previous manifest does not list is ever removed, whatever its name or
 * folder. A bundle with no manifest, or with one that is unreadable or
 * malformed, gets no removals. An entry that is absolute or climbs out of the
 * bundle is ignored.
 */
import fs from "node:fs/promises";
import path from "node:path";

import { fail } from "@agent-native/core/action";
import { eq } from "@agent-native/core/db/schema";

import type { ProjectVisibility } from "../shared/session-constants.js";
import { getDb, schema } from "./db/index.js";
import {
  applySlugPattern,
  findSequencedFolder,
  EXPORT_MANIFEST_FILE,
  formatLocalDate,
  nextSequence,
  parseExportManifest,
  planExport,
  proposeSlug,
  renderExportManifest,
  sanitizeSlug,
} from "./export.js";
import {
  bundlePathFor,
  fillBundlePath,
  getExportGate,
  getHandoffRow,
  HANDOFF_FILE,
  type ExportGateReason,
  type HandoffRow,
  parseBriefs,
} from "./handoff.js";
import { getProject } from "./projects.js";
import { describeTickets, ticketsAreCurrent } from "./tickets.js";
import { describeDecisions } from "./tree.js";

const NO_TICKETS_REASON = "This session has no tickets to export.";
const STALE_TICKETS_REASON =
  "The session's tickets are out of date with its spec and were not exported.";

export interface BundleFile {
  /** Relative to the bundle directory, forward slashes: `spec.md`, `issues/01-slug.md`. */
  relativePath: string;
  absolutePath: string;
  content: string;
}

export interface ExportBundlePlan {
  sessionId: string;
  project: {
    id: string;
    name: string;
    rootPath: string;
    exportFolder: string;
    slugPattern: string;
    visibility: ProjectVisibility;
  };
  /** The slug proposed from the session title. */
  proposedSlug: string;
  /** The slug actually used: the given one sanitized, or the proposal. */
  slug: string;
  folderName: string;
  /** Absolute path of the bundle directory. */
  bundleDir: string;
  /** The bundle directory relative to the project root, forward slashes: what a successful export stores on the session. */
  bundleFolder: string;
  /** Whether the bundle directory already exists, i.e. this export replaces an earlier one. */
  bundleExists: boolean;
  /** Every file the export writes: spec, issues in number order, then the manifest. */
  files: BundleFile[];
  /** Absolute paths from the previous manifest that the export removes. */
  removals: string[];
  /** The project's declared-tracker diagnostic, shown as a preview line when present. */
  trackerDiagnostic: string | null;
  ticketsExported: boolean;
  ticketsSkippedReason: string | null;
  /** The handoff row whose HANDOFF.md and briefs this plan writes, or null when the session has none. */
  handoff: HandoffRow | null;
  /** Whether `export-session` refuses to write this plan: no current handoff. */
  exportBlocked: boolean;
  /** Why export is blocked, or null once a current handoff exists. See "Export gate" above. */
  exportBlockedReason: ExportGateReason | null;
}

export interface PlanExportBundleInput {
  sessionId: string;
  /** The operator's slug; the proposal is used when omitted. */
  slug?: string;
  /** Clock for `{date}`; defaults to now. */
  now?: Date;
}

function errorCode(error: unknown): string | undefined {
  return (error as NodeJS.ErrnoException | undefined)?.code;
}

function isStrictlyInside(candidate: string, root: string): boolean {
  return candidate.startsWith(root.endsWith(path.sep) ? root : root + path.sep);
}

function refuseOutsideRoot(target: string): never {
  fail(`Refusing to export: ${target} resolves outside the project root.`, {
    errorCode: "export-outside-root",
    statusCode: 400,
    details: { path: target },
  });
}

/**
 * Where `target` really lands: `fs.realpath` of its deepest existing ancestor,
 * with the not-yet-existing remainder appended. A dangling symlink anywhere on
 * the way is refused, because writing through it would create its target.
 */
async function realLocation(target: string): Promise<string> {
  const remainder: string[] = [];
  let current = target;

  for (;;) {
    try {
      const real = await fs.realpath(current);
      return path.join(real, ...remainder.reverse());
    } catch (error) {
      const code = errorCode(error);
      if (code !== "ENOENT" && code !== "ENOTDIR") throw error;

      let present = true;
      try {
        await fs.lstat(current);
      } catch {
        present = false;
      }
      if (present) refuseOutsideRoot(target);

      const parent = path.dirname(current);
      if (parent === current) refuseOutsideRoot(target);
      remainder.push(path.basename(current));
      current = parent;
    }
  }
}

async function assertContained(targets: readonly string[], realRoot: string): Promise<void> {
  for (const target of targets) {
    if (!isStrictlyInside(await realLocation(target), realRoot)) refuseOutsideRoot(target);
  }
}

async function directoryNames(folder: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(folder, { withFileTypes: true });
    return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
  } catch (error) {
    if (errorCode(error) === "ENOENT" || errorCode(error) === "ENOTDIR") return [];
    throw error;
  }
}

async function exists(target: string): Promise<boolean> {
  try {
    await fs.lstat(target);
    return true;
  } catch {
    return false;
  }
}

/**
 * Paths the bundle's previous manifest lists that `planned` no longer
 * contains and that still exist, as absolute paths. No manifest, or a
 * malformed one, means none. Entries that are absolute or resolve outside the
 * bundle directory are ignored.
 */
async function manifestRemovals(
  bundleDir: string,
  planned: ReadonlySet<string>,
): Promise<string[]> {
  let content: string;
  try {
    content = await fs.readFile(path.join(bundleDir, EXPORT_MANIFEST_FILE), "utf8");
  } catch {
    return [];
  }
  const listed = parseExportManifest(content);
  if (!listed) return [];

  const manifestPath = path.join(bundleDir, EXPORT_MANIFEST_FILE);
  const removals = new Set<string>();
  for (const entry of listed) {
    if (entry.length === 0 || path.isAbsolute(entry) || entry.includes("\0")) continue;
    const absolute = path.resolve(bundleDir, entry);
    if (!isStrictlyInside(absolute, bundleDir)) continue;
    if (absolute === manifestPath || planned.has(absolute)) continue;

    let stats;
    try {
      stats = await fs.lstat(absolute);
    } catch {
      continue;
    }
    if (stats.isFile() || stats.isSymbolicLink()) removals.add(absolute);
  }
  return [...removals].sort();
}

function checkFolderName(folderName: string): void {
  if (
    folderName.length === 0 ||
    folderName === "." ||
    folderName === ".." ||
    /[\\/\0]/.test(folderName)
  ) {
    fail(`The project's slug pattern produced an unusable folder name: "${folderName}"`, {
      errorCode: "invalid-folder-name",
      statusCode: 400,
    });
  }
}

/**
 * Everything an export of this session would do, with no side effects: the
 * resolved folder name and bundle directory, every file with its content, the
 * stale owned files it would remove, and the project's tracker diagnostic.
 * Refuses (throws an action failure with an `errorCode`) when the session has
 * no project, no current spec, an empty slug, or any path that resolves
 * outside the real project root.
 */
export async function planExportBundle(input: PlanExportBundleInput): Promise<ExportBundlePlan> {
  const db = getDb();

  const [session] = await db
    .select()
    .from(schema.sessions)
    .where(eq(schema.sessions.id, input.sessionId))
    .limit(1);
  if (!session) fail(`Session not found: ${input.sessionId}`, { statusCode: 404 });

  if (!session.projectId) {
    fail("Choose the project this session exports into before exporting.", {
      errorCode: "no-project",
      statusCode: 409,
    });
  }

  const project = await getProject(session.projectId);
  if (!project) {
    fail(`Project not found: ${session.projectId}`, {
      errorCode: "project-not-found",
      statusCode: 404,
    });
  }

  const [spec] = await db
    .select()
    .from(schema.specs)
    .where(eq(schema.specs.sessionId, session.id))
    .limit(1);
  if (!spec) {
    fail("This session has no spec yet. Synthesize one before exporting.", {
      errorCode: "spec-missing",
      statusCode: 409,
    });
  }
  if (!spec.current) {
    fail("The spec is out of date with the design tree. Regenerate it before exporting.", {
      errorCode: "spec-not-current",
      statusCode: 409,
    });
  }

  const proposedSlug = proposeSlug(session.title, session.id);
  const slug = input.slug === undefined ? proposedSlug : sanitizeSlug(input.slug);
  if (slug.length === 0) {
    fail("The slug needs at least one letter or digit.", {
      errorCode: "invalid-slug",
      statusCode: 400,
    });
  }

  let realRoot: string;
  try {
    realRoot = await fs.realpath(project.rootPath);
  } catch {
    fail(`The project root no longer exists: ${project.rootPath}`, {
      errorCode: "project-root-missing",
      statusCode: 409,
    });
  }

  const exportDir = path.resolve(project.rootPath, project.exportFolder);
  const existingNames = await directoryNames(exportDir);
  const date = formatLocalDate(input.now ?? new Date());
  const folderName =
    findSequencedFolder(project.slugPattern, { slug, date }, existingNames) ??
    applySlugPattern(project.slugPattern, { slug, date, seq: nextSequence(existingNames) });
  checkFolderName(folderName);

  const bundleDir = path.join(exportDir, folderName);

  const ticketRows = await db
    .select()
    .from(schema.tickets)
    .where(eq(schema.tickets.sessionId, session.id))
    .orderBy(schema.tickets.number);

  let ticketsSkippedReason: string | null = null;
  let exportTickets: ReturnType<typeof describeTickets> = [];
  if (ticketRows.length === 0) {
    ticketsSkippedReason = NO_TICKETS_REASON;
  } else if (!ticketsAreCurrent(spec)) {
    ticketsSkippedReason = STALE_TICKETS_REASON;
  } else {
    exportTickets = describeTickets(ticketRows);
  }

  const decisionRows = await db
    .select()
    .from(schema.decisions)
    .where(eq(schema.decisions.sessionId, session.id))
    .orderBy(schema.decisions.createdAt, schema.decisions.id);

  const plan = planExport({
    sessionTitle: session.title,
    specMarkdown: spec.markdown,
    tickets: exportTickets,
    decisions: describeDecisions(decisionRows),
  });

  const handoff = (await getHandoffRow(session.id)) ?? null;
  const gate = await getExportGate(session.id);
  const handoffFiles: { relativePath: string; content: string }[] = [];
  if (handoff) {
    const bundlePath = bundlePathFor(project.visibility, project.rootPath, bundleDir);
    handoffFiles.push({
      relativePath: HANDOFF_FILE,
      content: fillBundlePath(handoff.markdown, bundlePath),
    });
    for (const brief of parseBriefs(handoff.briefsJson)) {
      handoffFiles.push({
        relativePath: brief.relativePath,
        content: fillBundlePath(brief.markdown, bundlePath),
      });
    }
  }

  const contentFiles = handoff
    ? [handoffFiles[0]!, ...plan.files, ...handoffFiles.slice(1)]
    : plan.files;

  const plannedFiles = [
    ...contentFiles,
    {
      relativePath: EXPORT_MANIFEST_FILE,
      content: renderExportManifest(contentFiles.map((file) => file.relativePath)),
    },
  ];

  const files: BundleFile[] = plannedFiles.map((file) => {
    const absolutePath = path.resolve(bundleDir, file.relativePath);
    if (!isStrictlyInside(absolutePath, bundleDir)) {
      fail(
        `Refusing to export: a planned file would land outside the bundle directory: ${file.relativePath}`,
        { errorCode: "path-escape", statusCode: 500 },
      );
    }
    return { relativePath: file.relativePath, absolutePath, content: file.content };
  });

  const removals = await manifestRemovals(
    bundleDir,
    new Set(files.map((file) => file.absolutePath)),
  );

  await assertContained(
    [bundleDir, ...files.map((file) => file.absolutePath), ...removals],
    realRoot,
  );

  return {
    sessionId: session.id,
    project: {
      id: project.id,
      name: project.name,
      rootPath: project.rootPath,
      exportFolder: project.exportFolder,
      slugPattern: project.slugPattern,
      visibility: project.visibility,
    },
    proposedSlug,
    slug,
    folderName,
    bundleDir,
    bundleFolder: path.relative(project.rootPath, bundleDir).split(path.sep).join("/"),
    bundleExists: await exists(bundleDir),
    files,
    removals,
    trackerDiagnostic: project.trackerDiagnostic,
    ticketsExported: exportTickets.length > 0,
    ticketsSkippedReason,
    handoff,
    exportBlocked: gate.blocked,
    exportBlockedReason: gate.reason,
  };
}

/**
 * Carry out a plan from {@link planExportBundle}: create missing folders,
 * write every planned file, then remove the stale owned files. Returns the
 * absolute paths written and removed, in plan order.
 */
export async function writeExportBundle(
  plan: ExportBundlePlan,
): Promise<{ written: string[]; removed: string[] }> {
  const written: string[] = [];
  for (const file of plan.files) {
    await fs.mkdir(path.dirname(file.absolutePath), { recursive: true });
    await fs.writeFile(file.absolutePath, file.content, "utf8");
    written.push(file.absolutePath);
  }

  const removed: string[] = [];
  for (const stale of plan.removals) {
    await fs.rm(stale, { force: true });
    removed.push(stale);
  }

  return { written, removed };
}
