/**
 * The export bundle: one directory per session inside its project's export
 * folder, holding `spec.md` at the top, `decisions.md` beside it when the
 * session settled something of its own, one `issues/NN-slug.md` per ticket,
 * and a manifest of what the export wrote.
 *
 *     <project root>/<export folder>/<folder name>/HANDOFF.md        (when a handoff exists)
 *     <project root>/<export folder>/<folder name>/spec.md
 *     <project root>/<export folder>/<folder name>/intent.md
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
 * `HANDOFF.md` and every eligible brief (see "Eligibility" below) are
 * re-rendered fresh at this point — with the session's current brief
 * grounding (see "Brief grounding state" below) — before their bundle path is
 * filled in: current grounding fills an eligible, covered brief's slots and
 * adds "Builds on"/"Proved by"; stale grounding renders the same under its
 * one-line note; a brief the grounding does not cover, or with no grounding
 * at all, still renders fresh but stays today's empty slots. This is the only
 * place grounding reaches a brief's text — `generate-handoff` and
 * `update-handoff` never read it.
 *
 * **Eligibility.** A stored text (HANDOFF.md, or one ticket's brief) is
 * eligible for this fresh render when nothing in the handoff has ever been
 * hand-edited (`editedAt` null — `update-handoff` is the only thing that sets
 * it), or, once something has, when this particular text still equals an
 * ungrounded render of it, the same one `generate-handoff` would have
 * written. Checking `editedAt` first, before ever comparing text, is what
 * makes a brief stored under an older template still eligible while nothing
 * has been edited: its exact bytes no longer match today's `renderBrief` once
 * the template's wording changes (as it did once already, in #54), but that
 * mismatch is not an edit. Once `editedAt` is set, though, the equality check
 * decides eligibility for *every* text, not only the one a person actually
 * touched — a brief nobody edited, still under that older template, becomes
 * ineligible the moment anything else in the handoff is edited, and stays
 * that way until the handoff is regenerated. An ineligible text is written
 * exactly as stored; grounding never touches it.
 *
 * **Grounded vs. eligible.** Eligibility alone is not "grounded": an eligible
 * brief with no grounding to apply, or with a grounding that does not cover
 * its ticket, still renders fresh but with nothing grounded in it. A brief
 * counts as grounded — for `groundedBriefs`, and for whether HANDOFF.md may
 * say the briefs are grounded — only when it is eligible *and* the session's
 * grounding (current or stale) has an entry for its ticket. Every other
 * brief this plan writes lands in `ungroundedBriefs` as `{ ticket, reason }`:
 * `edited` (ineligible), `no-grounding` (eligible, no grounding exists),
 * `not-covered` (eligible, a grounding exists but has no entry for this
 * ticket), or `kept` (eligible, covered, rendered grounded — but the file
 * already on disk was edited since the last export, so the hash guard is
 * keeping it instead). So a brief the grounding skipped, for any reason, is
 * never invisible. HANDOFF.md may say the briefs are grounded only when the
 * grounding is current *and* `ungroundedBriefs` is empty — every brief this
 * plan writes is actually grounded — *and* HANDOFF.md's own text is eligible;
 * otherwise it keeps today's fill-the-slots wording. Since `preview-export`
 * and `export-session` share this plan, the preview's file list, grounding
 * state and per-brief lists always match what a real export would write.
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
 * ## Brief grounding state
 *
 * `briefGroundingState` (`"absent"`, `"current"`, or `"stale"`, from
 * `currentBriefGrounding` in `server/brief-grounding.ts`) reports whether the
 * session's handoff briefs have been grounded and whether that grounding
 * still describes today's handoff and project; `briefGroundingStaleReason`
 * names why when stale (`"head-moved"` or `"handoff-changed"`), null
 * otherwise. This is informational only: nothing here or in `export-session`
 * ever refuses on it, unlike the export gate above.
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
 * the top of the bundle: the provenance record described in `export.ts`
 * (session, revision, scout commit, HEAD at export, and a hash per file Grill
 * Room wrote). The manifest is a planned file like any other: it appears in
 * the preview's file list and passes the same containment check.
 *
 * The removal candidates are exactly the paths the bundle's previous manifest
 * lists that the new plan no longer contains and that still exist, such as a
 * ticket dropped since the last export. Nothing the previous manifest does
 * not list is ever removed, whatever its name or folder. A bundle with no
 * manifest, or with one that is unreadable or malformed, gets no removals. An
 * entry that is absolute or climbs out of the bundle is ignored.
 *
 * ## The guard
 *
 * Every planned file already on disk, and every removal candidate, is
 * classified from disk when the plan is built:
 *
 * - **unedited** — the previous manifest records a hash for the path and the
 *   file's content hashes to it (CRLF normalised), or the previous manifest is
 *   version 1 and lists the path (trusted once);
 * - **edited** — anything else, including a file the previous manifest never
 *   listed.
 *
 * An edited file is **kept** — neither overwritten nor removed — unless its
 * bundle-relative path is in `overridePaths`. A kept file stays in the new
 * manifest with the hash Grill Room last wrote for it; one that was never
 * hashed is not added. Every override must resolve inside the bundle
 * directory, through symlinks, or the plan is refused with
 * `override-outside-bundle`.
 */
import fs from "node:fs/promises";
import path from "node:path";

import { fail } from "@agent-native/core/action";
import { eq } from "@agent-native/core/db/schema";

import type { ProjectVisibility } from "../shared/session-constants.js";
import { currentBriefGrounding, type BriefGroundingStaleReason } from "./brief-grounding.js";
import { getDb, schema } from "./db/index.js";
import {
  applySlugPattern,
  buildExportManifest,
  findSequencedFolder,
  EXPORT_MANIFEST_FILE,
  formatLocalDate,
  hashExportContent,
  nextSequence,
  parseExportManifest,
  type ParsedExportManifest,
  planExport,
  proposeSlug,
  renderExportManifest,
  sanitizeSlug,
} from "./export.js";
import { runGit } from "./git.js";
import {
  bundlePathFor,
  fillBundlePath,
  getExportGate,
  getHandoffRow,
  HANDOFF_FILE,
  loadHandoffSource,
  renderBrief,
  renderHandoffMarkdown,
  type ExportGateReason,
  type HandoffGrounding,
  type HandoffRow,
  parseBriefs,
} from "./handoff.js";
import { getProject } from "./projects.js";
import { currentReadiness } from "./readiness.js";
import { currentScoutReport } from "./scout-report.js";
import { describeTickets, ticketsAreCurrent } from "./tickets.js";
import { describeDecisions } from "./tree.js";

const NO_TICKETS_REASON = "This session has no tickets to export.";
const STALE_TICKETS_REASON =
  "The session's tickets are out of date with its spec and were not exported.";

/** Whether the session's handoff briefs have been grounded, and whether that grounding is still current. */
export type BriefGroundingState = "absent" | "current" | "stale";

/**
 * Why a brief is not grounded: `edited` (ineligible — a hand edit's text no
 * longer matches an ungrounded render), `no-grounding` (eligible, but the
 * session has no grounding at all), `not-covered` (eligible and a grounding
 * exists, but it has no entry for this ticket), or `kept` (eligible, covered,
 * and rendered grounded — but the file already on disk was edited since the
 * last export, so the hash guard is keeping it instead of writing this text).
 * `kept` is read from disk state alone, the same guard `plannedWrites`/`kept`
 * already reflects, so it can appear in a preview too, not only after a real
 * export writes (or, here, declines to write) the file.
 */
export type UngroundedBriefReason = "edited" | "no-grounding" | "not-covered" | "kept";

/** A brief this plan does not write grounded, and why. */
export interface UngroundedBrief {
  ticket: number;
  reason: UngroundedBriefReason;
}

export interface BundleFile {
  /** Relative to the bundle directory, forward slashes: `spec.md`, `issues/01-slug.md`. */
  relativePath: string;
  absolutePath: string;
  content: string;
  /** The file exists on disk and the guard classifies it as edited. Always false for the manifest. */
  edited: boolean;
  /** Edited and not overridden: the export leaves it as it is instead of writing it. */
  kept: boolean;
}

/** A file the previous manifest lists that the new plan drops. */
export interface BundleRemoval {
  /** Relative to the bundle directory, forward slashes. */
  relativePath: string;
  absolutePath: string;
  /** The guard classifies it as edited. */
  edited: boolean;
  /** Edited and not overridden: the export leaves it on disk instead of removing it. */
  kept: boolean;
}

export interface ExportBundlePlan {
  sessionId: string;
  project: {
    id: string;
    name: string;
    rootPath: string;
    workingExportFolder: string;
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
  /** Every planned file, kept ones included: spec, issues in number order, then the manifest. */
  files: BundleFile[];
  /** Every file the previous manifest lists that the plan drops and that still exists, kept ones included. */
  removals: BundleRemoval[];
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
  /** Whether the session's handoff briefs are grounded and current. See "Brief grounding state" above. */
  briefGroundingState: BriefGroundingState;
  /** Why the grounding is stale, or null while current or absent. */
  briefGroundingStaleReason: BriefGroundingStaleReason | null;
  /**
   * Ticket numbers of briefs this plan actually writes grounded: eligible
   * under the edit rule, and the session's grounding (current or stale) has
   * an entry for that ticket. See "Handoff" above.
   */
  groundedBriefs: number[];
  /** Every other brief this plan writes, with why it is not grounded. See "Handoff" above. */
  ungroundedBriefs: UngroundedBrief[];
}

export interface PlanExportBundleInput {
  sessionId: string;
  /** The operator's slug; the proposal is used when omitted. */
  slug?: string;
  /** Clock for `{date}`; defaults to now. */
  now?: Date;
  /** Bundle-relative paths of edited files to overwrite or remove anyway. */
  overridePaths?: readonly string[];
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

/** `absolute` relative to `bundleDir`, with forward slashes. */
function bundleRelative(bundleDir: string, absolute: string): string {
  return path.relative(bundleDir, absolute).split(path.sep).join("/");
}

/**
 * A manifest entry or override as an absolute path inside `bundleDir`, or
 * null when it is empty, absolute, holds a NUL, or climbs out of the bundle.
 */
function resolveInsideBundle(bundleDir: string, entry: string): string | null {
  if (entry.length === 0 || path.isAbsolute(entry) || entry.includes("\0")) return null;
  const absolute = path.resolve(bundleDir, entry);
  return isStrictlyInside(absolute, bundleDir) ? absolute : null;
}

/**
 * The bundle's previous manifest with every usable entry keyed by its
 * normalised bundle-relative path, or null when there is none or it is
 * malformed. Unusable entries (absolute, escaping the bundle) are dropped.
 */
async function readPreviousManifest(bundleDir: string): Promise<ParsedExportManifest | null> {
  let content: string;
  try {
    content = await fs.readFile(path.join(bundleDir, EXPORT_MANIFEST_FILE), "utf8");
  } catch {
    return null;
  }
  const parsed = parseExportManifest(content);
  if (!parsed) return null;

  const files: ParsedExportManifest["files"] = [];
  const seen = new Set<string>();
  for (const file of parsed.files) {
    const absolute = resolveInsideBundle(bundleDir, file.path);
    if (absolute === null) continue;
    const relativePath = bundleRelative(bundleDir, absolute);
    if (seen.has(relativePath)) continue;
    seen.add(relativePath);
    files.push({ path: relativePath, sha256: file.sha256 });
  }
  return { ...parsed, files };
}

/**
 * Paths the previous manifest lists that `planned` no longer contains and
 * that still exist as a file or symlink, as absolute paths, sorted.
 */
async function removalCandidates(
  bundleDir: string,
  previous: ParsedExportManifest | null,
  planned: ReadonlySet<string>,
): Promise<string[]> {
  if (!previous) return [];
  const manifestPath = path.join(bundleDir, EXPORT_MANIFEST_FILE);
  const removals = new Set<string>();
  for (const file of previous.files) {
    const absolute = path.resolve(bundleDir, file.path);
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

/**
 * Whether the file at `absolutePath` counts as edited against `previous`. A
 * missing file is not edited. See "The guard" above.
 */
async function isEdited(
  absolutePath: string,
  relativePath: string,
  previous: ParsedExportManifest | null,
): Promise<boolean> {
  if (!(await exists(absolutePath))) return false;
  const entry = previous?.files.find((file) => file.path === relativePath);
  if (!entry) return true;
  if (previous!.version === 1) return false;
  if (entry.sha256 === null) return true;
  try {
    return hashExportContent(await fs.readFile(absolutePath, "utf8")) !== entry.sha256;
  } catch {
    return true;
  }
}

function refuseOverride(override: string): never {
  fail(`Refusing to export: the override ${override} resolves outside the bundle directory.`, {
    errorCode: "override-outside-bundle",
    statusCode: 400,
    details: { path: override },
  });
}

/**
 * The overrides as normalised bundle-relative paths. Each must resolve inside
 * the bundle directory both lexically and through the filesystem.
 */
async function resolveOverrides(
  bundleDir: string,
  overrides: readonly string[],
): Promise<Set<string>> {
  const resolved = new Set<string>();
  if (overrides.length === 0) return resolved;
  const realBundle = await realLocation(bundleDir);
  for (const override of overrides) {
    const absolute = resolveInsideBundle(bundleDir, override);
    if (absolute === null) refuseOverride(override);
    if (!isStrictlyInside(await realLocation(absolute), realBundle)) refuseOverride(override);
    resolved.add(bundleRelative(bundleDir, absolute));
  }
  return resolved;
}

/** The project's HEAD commit, or null when it has none or is not a git repository. */
async function headCommit(root: string): Promise<string | null> {
  try {
    const head = await runGit(root, ["rev-parse", "HEAD"]);
    return head.exitCode === 0 ? head.stdout.trim() || null : null;
  } catch {
    return null;
  }
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

  const exportDir = path.resolve(project.rootPath, project.workingExportFolder);
  const existingNames = await directoryNames(exportDir);
  const date = formatLocalDate(input.now ?? new Date());
  const folderName =
    findSequencedFolder(project.slugPattern, { slug, date }, existingNames) ??
    applySlugPattern(project.slugPattern, { slug, date, seq: nextSequence(existingNames) });
  checkFolderName(folderName);

  const bundleDir = path.join(exportDir, folderName);

  // Hoisted so the handoff block below can work out, per brief, whether the
  // hash guard will keep its file — before deciding whether HANDOFF.md may
  // say the briefs are grounded. Whether a file is kept depends only on the
  // disk hash against the previous manifest and on `overridePaths`, never on
  // the content this plan renders for it, so reading these this early is
  // safe: nothing below changes what they report.
  const previous = await readPreviousManifest(bundleDir);
  const overrides = await resolveOverrides(bundleDir, input.overridePaths ?? []);

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

  const [readiness, scoutReport] = await Promise.all([
    currentReadiness(session),
    currentScoutReport(session),
  ]);

  const plan = planExport({
    sessionTitle: session.title,
    idea: session.idea,
    specMarkdown: spec.markdown,
    tickets: exportTickets,
    decisions: describeDecisions(decisionRows),
    readiness,
    scoutReport,
  });

  const handoff = (await getHandoffRow(session.id)) ?? null;
  const gate = await getExportGate(session.id);
  const grounding = await currentBriefGrounding(session.id);
  const briefGroundingState: BriefGroundingState = !grounding
    ? "absent"
    : grounding.current
      ? "current"
      : "stale";
  const briefGroundingStaleReason = grounding && !grounding.current ? grounding.staleReason : null;
  const groundingForRender: HandoffGrounding | null = grounding
    ? {
        tickets: grounding.result.tickets,
        commitRead: grounding.commitRead,
        current: grounding.current,
        staleReason: grounding.staleReason,
      }
    : null;
  const groundingCurrent = groundingForRender?.current === true;

  const handoffFiles: { relativePath: string; content: string }[] = [];
  // Populated inside `if (handoff)` below, before HANDOFF.md's own content is
  // decided, so its wording can already see the final answer — including
  // whether the hash guard will keep any brief's file.
  const groundedBriefs: number[] = [];
  const ungroundedBriefs: UngroundedBrief[] = [];
  if (handoff) {
    const bundlePath = bundlePathFor(project.visibility, project.rootPath, bundleDir);

    // Export is the one place grounding reaches the handoff's text: it
    // applies here, not at generation time, because grounding happens after
    // the handoff exists and can go stale on its own — rendering at export
    // is the only way to reflect its current state.
    //
    // A stored text (HANDOFF.md itself, or one ticket's brief) is eligible to
    // be re-rendered fresh only when nothing in the handoff has been
    // hand-edited (`editedAt` null — `update-handoff` is the only thing that
    // sets it), or, once something has, when this particular text still
    // equals an ungrounded render of it, the same one `generate-handoff`
    // would have written. `editedAt` null is checked first and short-circuits
    // the text comparison: a brief stored under an older template (its exact
    // text no longer matches today's `renderBrief`, because the template
    // changed after it was generated, not because anyone edited it) still
    // counts as eligible, so a template change alone can never silently stop
    // grounding from reaching it. Once `editedAt` is set, the equality check
    // applies to *every* text, not only the one a person actually touched: a
    // brief nobody edited, still sitting under an older template, becomes
    // ineligible the moment anything else in the handoff is edited, and stays
    // that way until the handoff is regenerated.
    //
    // Eligibility alone is not "grounded", though: an eligible text with no
    // grounding to apply, or with a grounding that does not cover its ticket,
    // still renders fresh (today's template) but with nothing grounded in
    // it. Nor is being eligible and covered enough on its own: the hash
    // guard may still keep the file already on disk instead of writing this
    // plan's grounded text (see "The guard" above) — whether a file is kept
    // depends only on its disk hash against the previous manifest and on
    // `overridePaths`, never on the content rendered for it, so it can be
    // checked here, before HANDOFF.md's own content is decided below. A
    // brief only counts as grounded — for `groundedBriefs`, and for whether
    // HANDOFF.md may say so — when it is eligible, the session's grounding
    // (current or stale) has an entry for its ticket, and the guard is not
    // keeping its file.
    const loadedSource = await loadHandoffSource(session.id);
    const briefSource = "source" in loadedSource ? loadedSource.source : null;
    const wasEdited = handoff.editedAt !== null;

    const briefEntries = parseBriefs(handoff.briefsJson);
    const briefFiles: { relativePath: string; content: string }[] = [];

    for (const brief of briefEntries) {
      const ticket = briefSource?.tickets.find((candidate) => candidate.number === brief.ticketNumber) ?? null;
      const eligible =
        briefSource !== null &&
        ticket !== null &&
        (!wasEdited || brief.markdown === renderBrief(briefSource, ticket));
      const covered =
        groundingForRender?.tickets.some((entry) => entry.number === brief.ticketNumber) ?? false;
      const markdown =
        eligible && briefSource !== null && ticket !== null
          ? renderBrief(briefSource, ticket, { grounding: groundingForRender })
          : brief.markdown;

      if (!eligible) {
        ungroundedBriefs.push({ ticket: brief.ticketNumber, reason: "edited" });
      } else if (!groundingForRender) {
        ungroundedBriefs.push({ ticket: brief.ticketNumber, reason: "no-grounding" });
      } else if (!covered) {
        ungroundedBriefs.push({ ticket: brief.ticketNumber, reason: "not-covered" });
      } else {
        const briefAbsolutePath = path.resolve(bundleDir, brief.relativePath);
        const briefEditedOnDisk = await isEdited(briefAbsolutePath, brief.relativePath, previous);
        const briefKept = briefEditedOnDisk && !overrides.has(brief.relativePath);
        if (briefKept) {
          ungroundedBriefs.push({ ticket: brief.ticketNumber, reason: "kept" });
        } else {
          groundedBriefs.push(brief.ticketNumber);
        }
      }

      briefFiles.push({ relativePath: brief.relativePath, content: fillBundlePath(markdown, bundlePath) });
    }

    // HANDOFF.md may say "the briefs are grounded" only once every brief this
    // plan writes really is grounded (the corrected `groundedBriefs` above —
    // eligible, covered, and not a `kept` file — not merely "eligible") and
    // the grounding itself is current — stale grounding still needs checking
    // against today's code, so it keeps today's fill-the-slots wording even
    // when every brief is covered. `ungroundedBriefs` already reflects the
    // hash guard at this point, computed per brief in the loop above, before
    // this decision is made — never after, or a brief the guard kept could
    // still count as grounded here.
    const allBriefsGrounded = briefEntries.length > 0 && ungroundedBriefs.length === 0;
    const useGroundedWording = groundingCurrent && allBriefsGrounded;
    const headerEligible =
      briefSource !== null && (!wasEdited || handoff.markdown === renderHandoffMarkdown(briefSource));
    const headerMarkdown =
      headerEligible && briefSource !== null
        ? renderHandoffMarkdown(briefSource, useGroundedWording)
        : handoff.markdown;
    handoffFiles.push({
      relativePath: HANDOFF_FILE,
      content: fillBundlePath(headerMarkdown, bundlePath),
    });
    handoffFiles.push(...briefFiles);
  }

  const contentFiles = handoff
    ? [handoffFiles[0]!, ...plan.files, ...handoffFiles.slice(1)]
    : plan.files;

  const plannedPaths = [
    ...contentFiles.map((file) => file.relativePath),
    EXPORT_MANIFEST_FILE,
  ].map((relativePath) => {
    const absolutePath = path.resolve(bundleDir, relativePath);
    if (!isStrictlyInside(absolutePath, bundleDir)) {
      fail(
        `Refusing to export: a planned file would land outside the bundle directory: ${relativePath}`,
        { errorCode: "path-escape", statusCode: 500 },
      );
    }
    return absolutePath;
  });

  const removalPaths = await removalCandidates(bundleDir, previous, new Set(plannedPaths));

  await assertContained([bundleDir, ...plannedPaths, ...removalPaths], realRoot);

  const contentBundleFiles: BundleFile[] = [];
  for (const [index, file] of contentFiles.entries()) {
    const absolutePath = plannedPaths[index]!;
    const edited = await isEdited(absolutePath, file.relativePath, previous);
    contentBundleFiles.push({
      relativePath: file.relativePath,
      absolutePath,
      content: file.content,
      edited,
      kept: edited && !overrides.has(file.relativePath),
    });
  }

  const removals: BundleRemoval[] = [];
  for (const absolutePath of removalPaths) {
    const relativePath = bundleRelative(bundleDir, absolutePath);
    const edited = await isEdited(absolutePath, relativePath, previous);
    removals.push({
      relativePath,
      absolutePath,
      edited,
      kept: edited && !overrides.has(relativePath),
    });
  }

  const manifest = buildExportManifest({
    sessionId: session.id,
    previous,
    scoutCommit: scoutReport?.commitRead ?? null,
    headCommit: await headCommit(project.rootPath),
    planned: contentBundleFiles,
    keptRemovals: removals.filter((removal) => removal.kept).map((removal) => removal.relativePath),
  });

  const files: BundleFile[] = [
    ...contentBundleFiles,
    {
      relativePath: EXPORT_MANIFEST_FILE,
      absolutePath: plannedPaths[plannedPaths.length - 1]!,
      content: renderExportManifest(manifest),
      edited: false,
      kept: false,
    },
  ];

  return {
    sessionId: session.id,
    project: {
      id: project.id,
      name: project.name,
      rootPath: project.rootPath,
      workingExportFolder: project.workingExportFolder,
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
    briefGroundingState,
    briefGroundingStaleReason,
    groundedBriefs,
    ungroundedBriefs,
  };
}

/**
 * Carry out a plan from {@link planExportBundle}: create missing folders,
 * write every planned file the guard did not keep, then remove the stale
 * owned files it did not keep. Returns the absolute paths written, removed
 * and kept, in plan order (kept writes before kept removals).
 */
export async function writeExportBundle(
  plan: ExportBundlePlan,
): Promise<{ written: string[]; removed: string[]; kept: string[] }> {
  const written: string[] = [];
  const kept: string[] = [];
  for (const file of plan.files) {
    if (file.kept) {
      kept.push(file.absolutePath);
      continue;
    }
    await fs.mkdir(path.dirname(file.absolutePath), { recursive: true });
    await fs.writeFile(file.absolutePath, file.content, "utf8");
    written.push(file.absolutePath);
  }

  const removed: string[] = [];
  for (const stale of plan.removals) {
    if (stale.kept) {
      kept.push(stale.absolutePath);
      continue;
    }
    await fs.rm(stale.absolutePath, { force: true });
    removed.push(stale.absolutePath);
  }

  return { written, removed, kept };
}
