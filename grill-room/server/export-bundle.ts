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
 * `{{BUNDLE}}` placeholders are filled with the working bundle path and their
 * `{{DOCS}}` placeholders with the durable one, each repo-relative when git
 * tracks that folder and absolute when it ignores it. When the two folders
 * differ in visibility, each one's paths and instructions follow its own.
 * Text stored before `{{DOCS}}` existed names the spec, intent and decisions
 * under `{{BUNDLE}}`; `fillBundlePath` moves those paths to `{{DOCS}}` first.
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
 * it), or, once something has, when this particular text is unedited: it
 * still matches its own generated baseline (`markdownGeneratedSha256` for
 * HANDOFF.md, `generatedSha256` for a brief). A text stored under an older
 * template therefore stays eligible after another text is edited: its bytes
 * no longer match today's render, but they still match the baseline they were
 * generated with, and that mismatch is not an edit. Only a text with no
 * baseline (stored before baselines existed) still uses the render
 * comparison: it is eligible when, with its old spec paths moved to
 * `{{DOCS}}`, it equals an ungrounded render of it, the same one
 * `generate-handoff` would write today. An ineligible text is written as
 * stored, with its bundle paths filled; grounding never touches it.
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
 * the handoff is current. When the handoff gate is clear, it is
 * `"durable-folder-ignored"` if git confirms the durable bundle folder is
 * ignored; `durableFolderIgnored` reports that whatever the handoff says. This module only reports it — `preview-export`
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
import {
  collisionKey,
  currentBriefGrounding,
  type BriefGroundingStaleReason,
  type BriefGroundingWithStaleness,
} from "./brief-grounding.js";
import { getDb, schema } from "./db/index.js";
import { pendingForProject, type PendingDelegationProposal } from "./delegation-values.js";
import {
  applySlugPattern,
  buildExportManifest,
  DECISIONS_FILE,
  findSequencedFolder,
  EXPORT_MANIFEST_FILE,
  type ExportRootKind,
  formatLocalDate,
  hashExportContent,
  INTENT_FILE,
  nextSequence,
  parseExportManifest,
  type ParsedExportManifest,
  planExport,
  type PlannedExportFile,
  proposeSlug,
  renderExportManifest,
  sanitizeSlug,
} from "./export.js";
import { runGit } from "./git.js";
import {
  bundlePathFor,
  fillBundlePath,
  withDocsToken,
  getExportGate,
  getHandoffRow,
  HANDOFF_FILE,
  loadHandoffSource,
  renderBrief,
  renderHandoffMarkdown,
  partitionRuleConflicts,
  type ExportFacts,
  type ExportGateReason,
  type HandoffGrounding,
  type HandoffRow,
  type HandoffSource,
  parseBriefs,
} from "./handoff.js";
import { getProject, measuredVisibility } from "./projects.js";
import { currentReadiness } from "./readiness.js";
import { currentScoutReport } from "./scout-report.js";
import { describeTickets, separateOverlaps, ticketsAreCurrent } from "./tickets.js";
import { describeDecisions } from "./tree.js";

const NO_TICKETS_REASON = "This session has no tickets to export.";
const STALE_TICKETS_REASON =
  "The session's tickets are out of date with its spec and were not exported.";

/** Whether the session's handoff briefs have been grounded, and whether that grounding is still current. */
export type BriefGroundingState = "absent" | "current" | "stale";

/**
 * Why a brief is not grounded: `edited` (ineligible — its stored text no
 * longer matches its generated baseline (or, with no baseline, today's
 * ungrounded render)), `no-grounding` (eligible, but the
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
  /** The root whose bundle folder holds it. */
  root: ExportRootKind;
  /** Relative to its root's bundle directory, forward slashes: `spec.md`, `issues/01-slug.md`. */
  relativePath: string;
  /** Relative to the project root, forward slashes: `docs/specs/a/spec.md`. What `overridePaths` names. */
  rootRelativePath: string;
  absolutePath: string;
  content: string;
  /** The file exists on disk and the guard classifies it as edited. Always false for the manifest. */
  edited: boolean;
  /** Edited and not overridden: the export leaves it as it is instead of writing it. */
  kept: boolean;
}

/** A file the previous manifest lists that the new plan drops. */
export interface BundleRemoval {
  /** The root whose bundle folder holds it. */
  root: ExportRootKind;
  /** Relative to its root's bundle directory, forward slashes. */
  relativePath: string;
  /** Relative to the project root, forward slashes. What `overridePaths` names. */
  rootRelativePath: string;
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
    durableExportFolder: string;
    slugPattern: string;
    /** The stored flag, as registration seeded it or the owner set it; export never writes it. */
    visibility: ProjectVisibility;
  };
  /**
   * What this export used for its bundle paths and wording: a fresh `git
   * check-ignore` of the working bundle folder itself, or the stored flag
   * when git gave no answer.
   */
  effectiveVisibility: ProjectVisibility;
  /** Whether the repository had no commits at export, so HANDOFF.md and the briefs say it is greenfield. */
  greenfield: boolean;
  /** The slug proposed from the session title. */
  proposedSlug: string;
  /** The slug actually used: the given one sanitized, or the proposal. */
  slug: string;
  /** The bundle folder's name, shared by both roots. */
  folderName: string;
  /** Absolute path of the working bundle directory. */
  bundleDir: string;
  /** The working bundle directory relative to the project root, forward slashes: what a successful export stores on the session. */
  bundleFolder: string;
  /** The exact string this plan substitutes for `{{BUNDLE}}` in HANDOFF.md and the briefs. */
  bundlePath: string;
  /** Whether the working bundle directory already exists, i.e. this export replaces an earlier one. */
  bundleExists: boolean;
  /** Absolute path of the durable bundle directory. */
  durableBundleDir: string;
  /** The durable bundle directory relative to the project root, forward slashes. */
  durableBundleFolder: string;
  /**
   * The exact string this plan substitutes for `{{DOCS}}` in HANDOFF.md and
   * the briefs: the durable bundle directory, repo-relative when git says the
   * durable bundle folder is not ignored, absolute when it is, and following
   * the stored flag when git cannot tell.
   */
  durableBundlePath: string;
  /** Whether the durable bundle directory already exists. */
  durableBundleExists: boolean;
  /**
   * Every planned file, kept ones included, durable root first: spec, intent,
   * decisions, the durable manifest; then HANDOFF.md, issues in number order,
   * briefs, the working manifest.
   */
  files: BundleFile[];
  /** Every file a root's previous manifest lists that the plan drops from that root and that still exists, kept ones included, durable root first. */
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
  /** Whether git confirms the durable bundle folder is ignored; reported whatever the handoff gate says. */
  durableFolderIgnored: boolean;
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
  /**
   * The grounding's delegation proposals the owner has neither confirmed nor
   * dismissed, from the current or stale grounding; empty with no grounding.
   * Never part of the export gate.
   */
  delegationProposals: PendingDelegationProposal[];
  /**
   * Each open rule conflict of the grounding (current or stale), the ones no
   * waiver accepts, in the order `ruleConflicts` returns them; empty with no
   * handoff or no grounding. Never part of the export gate.
   */
  ruleConflicts: PreviewRuleConflict[];
  /** The conflicts the owner accepted as is, with the waiver and its reason; same order and rules as `ruleConflicts`. */
  acceptedRuleConflicts: PreviewAcceptedRuleConflict[];
}

export type PreviewAcceptedRuleConflict = PreviewRuleConflict & { waiverId: string; reason: string };

/** The preview's two conflict lists, with each entry's ticket title added. */
export function ruleConflictLists(
  source: HandoffSource,
  grounding: HandoffGrounding | null,
): { ruleConflicts: PreviewRuleConflict[]; acceptedRuleConflicts: PreviewAcceptedRuleConflict[] } {
  const titleOf = (ticket: number) => source.tickets.find((candidate) => candidate.number === ticket)?.title ?? "";
  const { open, accepted } = partitionRuleConflicts(source, grounding);
  return {
    ruleConflicts: open.map((conflict) => ({ ...conflict, title: titleOf(conflict.ticket) })),
    acceptedRuleConflicts: accepted.map((conflict) => ({ ...conflict, title: titleOf(conflict.ticket) })),
  };
}

/** The grounding as the renderers take it. */
export function handoffGroundingOf(grounding: BriefGroundingWithStaleness | null): HandoffGrounding | null {
  return grounding
    ? {
        tickets: grounding.result.tickets,
        commitRead: grounding.commitRead,
        current: grounding.current,
        staleReason: grounding.staleReason,
        rulesRead: grounding.result.rulesRead,
        delegationProposals: grounding.result.delegationProposals,
      }
    : null;
}

/** The session's conflict lists, both empty with no handoff or no loadable source. */
export async function loadRuleConflictLists(
  sessionId: string,
): Promise<{ ruleConflicts: PreviewRuleConflict[]; acceptedRuleConflicts: PreviewAcceptedRuleConflict[] }> {
  const empty = { ruleConflicts: [], acceptedRuleConflicts: [] };
  if (!(await getHandoffRow(sessionId))) return empty;
  const loaded = await loadHandoffSource(sessionId);
  if (!("source" in loaded)) return empty;
  return ruleConflictLists(loaded.source, handoffGroundingOf(await currentBriefGrounding(sessionId)));
}

/** One rule conflict, as the preview lists it. */
export interface PreviewRuleConflict {
  ticket: number;
  /** The ticket's title, as `source.tickets` holds it. */
  title: string;
  citation: string;
  statement: string;
  missingFiles: string[];
}

export interface PlanExportBundleInput {
  sessionId: string;
  /** The operator's slug; the proposal is used when omitted. */
  slug?: string;
  /** Clock for `{date}`; defaults to now. */
  now?: Date;
  /** Project-root-relative paths of edited files to overwrite or remove anyway. */
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
 * One root's previous manifest, read from that root's bundle folder, with
 * every usable entry keyed by its normalised bundle-relative path, or null
 * when there is none, it is malformed, or it is a version-3 manifest that
 * describes the other root. Unusable entries (absolute, escaping the bundle)
 * are dropped. A version-1 or version-2 manifest governs whichever root's
 * folder it sits in.
 */
async function readPreviousManifest(
  bundleDir: string,
  root: ExportRootKind,
): Promise<ParsedExportManifest | null> {
  let content: string;
  try {
    content = await fs.readFile(path.join(bundleDir, EXPORT_MANIFEST_FILE), "utf8");
  } catch {
    return null;
  }
  const parsed = parseExportManifest(content);
  if (!parsed) return null;
  if (parsed.version === 3 && parsed.root !== root) return null;

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
  fail(`Refusing to export: the override ${override} resolves outside both bundle directories.`, {
    errorCode: "override-outside-bundle",
    statusCode: 400,
    details: { path: override },
  });
}

/**
 * The overrides as normalised project-root-relative paths. Each is read
 * relative to the project root and must resolve inside one of the bundle
 * directories both lexically and through the filesystem.
 */
async function resolveOverrides(
  rootPath: string,
  bundleDirs: readonly string[],
  overrides: readonly string[],
): Promise<Set<string>> {
  const resolved = new Set<string>();
  if (overrides.length === 0) return resolved;
  const realBundles = await Promise.all(bundleDirs.map((bundleDir) => realLocation(bundleDir)));
  for (const override of overrides) {
    const absolute = resolveInsideBundle(rootPath, override);
    if (absolute === null) refuseOverride(override);
    const real = await realLocation(absolute);
    const inside = bundleDirs.some(
      (bundleDir, index) =>
        isStrictlyInside(absolute, bundleDir) && isStrictlyInside(real, realBundles[index]!),
    );
    if (!inside) refuseOverride(override);
    resolved.add(bundleRelative(rootPath, absolute));
  }
  return resolved;
}

/** The project's HEAD commit, or null when it has none or is not a git repository. */
export async function headCommit(root: string): Promise<string | null> {
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

/** The files that explain the built system: written to the durable root. Everything else is working. */
const DURABLE_FILES: ReadonlySet<string> = new Set(["spec.md", INTENT_FILE, DECISIONS_FILE]);

/**
 * Each planned file of one root, then its manifest, as absolute paths inside
 * `bundleDir`; refused with `path-escape` when one would land outside it.
 */
function plannedPathsIn(bundleDir: string, content: readonly PlannedExportFile[]): string[] {
  return [...content.map((file) => file.relativePath), EXPORT_MANIFEST_FILE].map((relativePath) => {
    const absolutePath = path.resolve(bundleDir, relativePath);
    if (!isStrictlyInside(absolutePath, bundleDir)) {
      fail(
        `Refusing to export: a planned file would land outside the bundle directory: ${relativePath}`,
        { errorCode: "path-escape", statusCode: 500 },
      );
    }
    return absolutePath;
  });
}

/**
 * One root's half of the plan: its files classified by the guard against its
 * own previous manifest, then its manifest, and its removals.
 */
async function planRoot(input: {
  root: ExportRootKind;
  bundleDir: string;
  otherRootFolder: string;
  sessionId: string;
  scoutCommit: string | null;
  headCommit: string | null;
  previous: ParsedExportManifest | null;
  content: readonly PlannedExportFile[];
  plannedPaths: readonly string[];
  removalPaths: readonly string[];
  overrides: ReadonlySet<string>;
  rootRelative: (absolutePath: string) => string;
}): Promise<{ files: BundleFile[]; removals: BundleRemoval[] }> {
  const { root, bundleDir, previous, overrides, rootRelative } = input;

  const contentFiles: BundleFile[] = [];
  for (const [index, file] of input.content.entries()) {
    const absolutePath = input.plannedPaths[index]!;
    const rootRelativePath = rootRelative(absolutePath);
    const edited = await isEdited(absolutePath, file.relativePath, previous);
    contentFiles.push({
      root,
      relativePath: file.relativePath,
      rootRelativePath,
      absolutePath,
      content: file.content,
      edited,
      kept: edited && !overrides.has(rootRelativePath),
    });
  }

  const removals: BundleRemoval[] = [];
  for (const absolutePath of input.removalPaths) {
    const relativePath = bundleRelative(bundleDir, absolutePath);
    const rootRelativePath = rootRelative(absolutePath);
    const edited = await isEdited(absolutePath, relativePath, previous);
    removals.push({
      root,
      relativePath,
      rootRelativePath,
      absolutePath,
      edited,
      kept: edited && !overrides.has(rootRelativePath),
    });
  }

  const manifest = buildExportManifest({
    sessionId: input.sessionId,
    root,
    otherRootFolder: input.otherRootFolder,
    previous,
    scoutCommit: input.scoutCommit,
    headCommit: input.headCommit,
    planned: contentFiles,
    keptRemovals: removals.filter((removal) => removal.kept).map((removal) => removal.relativePath),
  });
  const manifestPath = input.plannedPaths[input.plannedPaths.length - 1]!;

  return {
    files: [
      ...contentFiles,
      {
        root,
        relativePath: EXPORT_MANIFEST_FILE,
        rootRelativePath: rootRelative(manifestPath),
        absolutePath: manifestPath,
        content: renderExportManifest(manifest),
        edited: false,
        kept: false,
      },
    ],
    removals,
  };
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

  // One folder name for both roots, so `{seq}` and the reuse of an earlier
  // sequenced folder read the folder names of both.
  const durableExportDir = path.resolve(project.rootPath, project.durableExportFolder);
  const workingExportDir = path.resolve(project.rootPath, project.workingExportFolder);
  const existingNames = [
    ...(await directoryNames(durableExportDir)),
    ...(await directoryNames(workingExportDir)),
  ];
  const date = formatLocalDate(input.now ?? new Date());
  const folderName =
    findSequencedFolder(project.slugPattern, { slug, date }, existingNames) ??
    applySlugPattern(project.slugPattern, { slug, date, seq: nextSequence(existingNames) });
  checkFolderName(folderName);

  const bundleDir = path.join(workingExportDir, folderName);
  const bundleFolder = bundleRelative(project.rootPath, bundleDir);
  const durableBundleDir = path.join(durableExportDir, folderName);
  const durableBundleFolder = bundleRelative(project.rootPath, durableBundleDir);
  // The durable folder's own visibility, so `{{DOCS}}` and the wording around
  // it follow it. A durable folder git cannot classify follows the stored flag
  // silently: `visibilityUnchecked` describes the working folder only.
  const durableMeasured = await measuredVisibility(project.rootPath, durableBundleFolder);
  const durableVisibility = durableMeasured ?? project.visibility;
  const durableFolderIgnored = durableMeasured === "ignored";
  const rootRelative = (absolutePath: string) => bundleRelative(project.rootPath, absolutePath);

  // Measured fresh for this export only: the stored flag goes stale when an
  // ignore rule changes after registration, and nothing else looks at
  // whether the repository has commits.
  const head = await headCommit(project.rootPath);
  const measured = await measuredVisibility(project.rootPath, bundleFolder);
  const exportFacts: ExportFacts = {
    visibility: measured ?? project.visibility,
    greenfield: head === null,
    ...(measured === null ? { visibilityUnchecked: true } : {}),
    durableVisibility,
  };

  // Hoisted so the handoff block below can work out, per brief, whether the
  // hash guard will keep its file — before deciding whether HANDOFF.md may
  // say the briefs are grounded. Whether a file is kept depends only on the
  // disk hash against the previous manifest and on `overridePaths`, never on
  // the content this plan renders for it, so reading these this early is
  // safe: nothing below changes what they report.
  const durablePrevious = await readPreviousManifest(durableBundleDir, "durable");
  const workingPrevious = await readPreviousManifest(bundleDir, "working");
  const overrides = await resolveOverrides(
    project.rootPath,
    [durableBundleDir, bundleDir],
    input.overridePaths ?? [],
  );

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
  const exportBlockedReason: ExportGateReason | null =
    gate.reason ?? (durableFolderIgnored ? "durable-folder-ignored" : null);
  const grounding = await currentBriefGrounding(session.id);
  const briefGroundingState: BriefGroundingState = !grounding
    ? "absent"
    : grounding.current
      ? "current"
      : "stale";
  const briefGroundingStaleReason = grounding && !grounding.current ? grounding.staleReason : null;
  const groundingForRender = handoffGroundingOf(grounding);
  const groundingCurrent = groundingForRender?.current === true;

  // Hoisted above the `if (handoff)` block so `preview-export` can report
  // what `{{BUNDLE}}` and `{{DOCS}}` become for this plan even before a
  // handoff exists.
  const bundlePath = bundlePathFor(exportFacts.visibility, project.rootPath, bundleDir);
  const durableBundlePath = bundlePathFor(durableVisibility, project.rootPath, durableBundleDir);

  const handoffFiles: { relativePath: string; content: string }[] = [];
  // Populated inside `if (handoff)` below, before HANDOFF.md's own content is
  // decided, so its wording can already see the final answer — including
  // whether the hash guard will keep any brief's file.
  const groundedBriefs: number[] = [];
  const ungroundedBriefs: UngroundedBrief[] = [];
  let previewLists: ReturnType<typeof ruleConflictLists> = { ruleConflicts: [], acceptedRuleConflicts: [] };
  if (handoff) {
    // Export is the one place grounding reaches the handoff's text: it
    // applies here, not at generation time, because grounding happens after
    // the handoff exists and can go stale on its own — rendering at export
    // is the only way to reflect its current state.
    //
    // A stored text (HANDOFF.md itself, or one ticket's brief) is eligible to
    // be re-rendered fresh when nothing in the handoff has been hand-edited
    // (`editedAt` null — `update-handoff` is the only thing that sets it),
    // or, once something has, when this particular text is unedited: it
    // still hashes to its own generated baseline. A text stored under an
    // older template (or before `{{DOCS}}` existed) no longer matches today's
    // render, but it still matches the baseline it was generated with, so a
    // template change alone never stops grounding from reaching it, even
    // after another text is edited. Only a text with no baseline (stored
    // before baselines existed) falls back to comparing it, with its old spec
    // paths moved to `{{DOCS}}`, against an ungrounded render.
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
    if (briefSource) {
      previewLists = ruleConflictLists(briefSource, groundingForRender);
    }

    // Only a current grounding says which files each ticket changes today, so
    // only then may HANDOFF.md separate overlapping tickets and say that
    // tickets in one wave may run in parallel. This keys off the raw
    // `current` flag, not `useGroundedWording` below.
    const separated =
      grounding?.current && briefSource
        ? separateOverlaps(
            briefSource.tickets.map((ticket) => ({
              number: ticket.number,
              blockedBy: ticket.blockedBy,
              files: (
                grounding.result.tickets.find((entry) => entry.number === ticket.number)
                  ?.filesToChange ?? []
              ).map((file) => file.path),
            })),
            collisionKey,
          )
        : null;
    const handoffExportFacts: ExportFacts = separated?.ok
      ? { ...exportFacts, waves: separated.waves, implicitEdges: separated.implicitEdges }
      : exportFacts;

    const briefEntries = parseBriefs(handoff.briefsJson);
    const briefFiles: { relativePath: string; content: string }[] = [];

    for (const brief of briefEntries) {
      const ticket = briefSource?.tickets.find((candidate) => candidate.number === brief.ticketNumber) ?? null;
      const eligible =
        briefSource !== null &&
        ticket !== null &&
        (!wasEdited ||
          (brief.generatedSha256 !== undefined
            ? hashExportContent(brief.markdown) === brief.generatedSha256
            : withDocsToken(brief.markdown) === renderBrief(briefSource, ticket)));
      const covered =
        groundingForRender?.tickets.some((entry) => entry.number === brief.ticketNumber) ?? false;
      const markdown =
        eligible && briefSource !== null && ticket !== null
          ? renderBrief(briefSource, ticket, { grounding: groundingForRender }, exportFacts)
          : brief.markdown;

      if (!eligible) {
        ungroundedBriefs.push({ ticket: brief.ticketNumber, reason: "edited" });
      } else if (!groundingForRender) {
        ungroundedBriefs.push({ ticket: brief.ticketNumber, reason: "no-grounding" });
      } else if (!covered) {
        ungroundedBriefs.push({ ticket: brief.ticketNumber, reason: "not-covered" });
      } else {
        const briefAbsolutePath = path.resolve(bundleDir, brief.relativePath);
        const briefEditedOnDisk = await isEdited(briefAbsolutePath, brief.relativePath, workingPrevious);
        const briefKept = briefEditedOnDisk && !overrides.has(rootRelative(briefAbsolutePath));
        if (briefKept) {
          ungroundedBriefs.push({ ticket: brief.ticketNumber, reason: "kept" });
        } else {
          groundedBriefs.push(brief.ticketNumber);
        }
      }

      briefFiles.push({ relativePath: brief.relativePath, content: fillBundlePath(markdown, bundlePath, durableBundlePath) });
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
      briefSource !== null &&
      (!wasEdited ||
        (handoff.markdownGeneratedSha256 !== null
          ? hashExportContent(handoff.markdown) === handoff.markdownGeneratedSha256
          : withDocsToken(handoff.markdown) === renderHandoffMarkdown(briefSource)));
    const headerMarkdown =
      headerEligible && briefSource !== null
        ? renderHandoffMarkdown(briefSource, useGroundedWording, handoffExportFacts, groundingForRender)
        : handoff.markdown;
    handoffFiles.push({
      relativePath: HANDOFF_FILE,
      content: fillBundlePath(headerMarkdown, bundlePath, durableBundlePath),
    });
    handoffFiles.push(...briefFiles);
  }

  const durableContent = plan.files.filter((file) => DURABLE_FILES.has(file.relativePath));
  const workingContent = [
    ...handoffFiles.slice(0, 1),
    ...plan.files.filter((file) => !DURABLE_FILES.has(file.relativePath)),
    ...handoffFiles.slice(1),
  ];

  const durablePlannedPaths = plannedPathsIn(durableBundleDir, durableContent);
  const workingPlannedPaths = plannedPathsIn(bundleDir, workingContent);
  const durableRemovalPaths = await removalCandidates(
    durableBundleDir,
    durablePrevious,
    new Set(durablePlannedPaths),
  );
  const workingRemovalPaths = await removalCandidates(
    bundleDir,
    workingPrevious,
    new Set(workingPlannedPaths),
  );

  await assertContained(
    [
      durableBundleDir,
      bundleDir,
      ...durablePlannedPaths,
      ...workingPlannedPaths,
      ...durableRemovalPaths,
      ...workingRemovalPaths,
    ],
    realRoot,
  );

  const manifestBase = {
    sessionId: session.id,
    scoutCommit: scoutReport?.commitRead ?? null,
    headCommit: head,
    rootRelative,
    overrides,
  };
  const durable = await planRoot({
    ...manifestBase,
    root: "durable",
    bundleDir: durableBundleDir,
    otherRootFolder: bundleFolder,
    previous: durablePrevious,
    content: durableContent,
    plannedPaths: durablePlannedPaths,
    removalPaths: durableRemovalPaths,
  });
  const working = await planRoot({
    ...manifestBase,
    root: "working",
    bundleDir,
    otherRootFolder: durableBundleFolder,
    previous: workingPrevious,
    content: workingContent,
    plannedPaths: workingPlannedPaths,
    removalPaths: workingRemovalPaths,
  });

  return {
    sessionId: session.id,
    project: {
      id: project.id,
      name: project.name,
      rootPath: project.rootPath,
      workingExportFolder: project.workingExportFolder,
      durableExportFolder: project.durableExportFolder,
      slugPattern: project.slugPattern,
      visibility: project.visibility,
    },
    effectiveVisibility: exportFacts.visibility,
    greenfield: exportFacts.greenfield,
    proposedSlug,
    slug,
    folderName,
    bundleDir,
    bundleFolder,
    bundlePath,
    bundleExists: await exists(bundleDir),
    durableBundleDir,
    durableBundleFolder,
    durableBundlePath,
    durableBundleExists: await exists(durableBundleDir),
    files: [...durable.files, ...working.files],
    removals: [...durable.removals, ...working.removals],
    trackerDiagnostic: project.trackerDiagnostic,
    ticketsExported: exportTickets.length > 0,
    ticketsSkippedReason,
    handoff,
    exportBlocked: exportBlockedReason !== null,
    exportBlockedReason,
    durableFolderIgnored,
    briefGroundingState,
    briefGroundingStaleReason,
    groundedBriefs,
    ungroundedBriefs,
    delegationProposals: pendingForProject(project, grounding?.result.delegationProposals),
    ...previewLists,
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
