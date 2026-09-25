/**
 * Export's pure parts: the bundle's folder name (slug proposal, slug pattern)
 * and the files the local-markdown tracker layout expects (see repo-root
 * `docs/agents/issue-tracker.md`), plus the session's `decisions.md` and
 * `intent.md`, with their content. Nothing here touches the
 * filesystem — `server/export-bundle.ts` reads what already exists, enforces
 * containment and does the writes; this module only decides names and renders
 * content. Tested through the `preview-export` and `export-session` actions,
 * the same convention `tickets.ts` and `tree.ts` follow.
 */

import { createHash } from "node:crypto";

import type { StoredReadiness } from "./readiness.js";
import type { ScoutReportWithStaleness } from "./scout-report.js";
import type { DecisionView } from "./tree.js";

const STATUS_LINE = "Status: ready-for-agent";

/** The decisions record every export with something settled writes beside the spec. */
export const DECISIONS_FILE = "decisions.md";

/** The why, for people: rendered from stored data, written beside the spec on every export. */
export const INTENT_FILE = "intent.md";

/** A ticket as `export-session` hands it here: `blockedBy` already resolved to ticket numbers. */
export interface ExportTicket {
  number: number;
  slug: string;
  title: string;
  body: string;
  blockedBy: readonly number[];
}

export interface PlannedExportFile {
  /** Path relative to the feature directory, e.g. `"spec.md"` or `"issues/01-slug.md"`. */
  relativePath: string;
  content: string;
}

export interface ExportPlan {
  /** Spec first, then `intent.md`, then `decisions.md` when planned, then issues in ticket-number order — the order `export-session` writes and reports them in. */
  files: PlannedExportFile[];
}

/**
 * The manifest every export writes at the top of its bundle: the provenance
 * record of what Grill Room wrote there. Version 2 names the session, counts
 * exports (`revision`), records the scout report's commit and the project's
 * HEAD at export time, and holds, for each file Grill Room wrote, the sha256
 * of its content with CRLF normalised to LF. It carries no timestamps, so it
 * changes only when something real changes.
 *
 * A re-export compares each file already on disk with the hash recorded here
 * to tell whether it was edited in the repo, and removes only paths listed
 * here, so a file the export did not write is never removed or overwritten
 * unasked. Version 1 (paths only) still parses: its files count as written by
 * Grill Room and unedited, once.
 */
export const EXPORT_MANIFEST_FILE = ".grill-room-export.json";

export const EXPORT_MANIFEST_VERSION = 2;

export interface ExportManifestFile {
  /** Relative to the bundle directory, forward slashes. */
  path: string;
  /** sha256 of the content Grill Room wrote, CRLF normalised to LF, lowercase hex. */
  sha256: string;
}

/** What {@link renderExportManifest} writes. */
export interface ExportManifestV2 {
  version: 2;
  sessionId: string;
  revision: number;
  scoutCommit: string | null;
  headCommit: string | null;
  files: ExportManifestFile[];
}

/**
 * A previous manifest as {@link parseExportManifest} reads it, either
 * version. A version-1 manifest has revision 0, no session or commits, and a
 * null hash for every file.
 */
export interface ParsedExportManifest {
  version: 1 | 2;
  sessionId: string | null;
  revision: number;
  scoutCommit: string | null;
  headCommit: string | null;
  files: { path: string; sha256: string | null }[];
}

/** The hash a manifest records for `content`: sha256 hex of it with every CRLF turned into LF. */
export function hashExportContent(content: string): string {
  return createHash("sha256").update(content.replace(/\r\n/g, "\n"), "utf8").digest("hex");
}

export interface BuildExportManifestInput {
  sessionId: string;
  /** The bundle's previous manifest, or null when it has none (or an unreadable one). */
  previous: ParsedExportManifest | null;
  scoutCommit: string | null;
  headCommit: string | null;
  /**
   * Every planned file in plan order (the manifest itself excluded), with the
   * content Grill Room planned for it and whether the guard kept the file on
   * disk instead of writing it.
   */
  planned: readonly { relativePath: string; content: string; kept: boolean }[];
  /** Paths the previous manifest listed that the plan drops but the guard kept on disk. */
  keptRemovals: readonly string[];
}

/**
 * The next manifest. A written file gets the hash of its new content. A kept
 * file keeps the hash Grill Room last wrote for it, so later exports go on
 * flagging it; a kept file the previous manifest never hashed is left out.
 * The revision is one past the previous manifest's (a version-1 manifest
 * counts as revision 0), or 1 when there was none.
 */
export function buildExportManifest(input: BuildExportManifestInput): ExportManifestV2 {
  const previousHashes = new Map<string, string>();
  for (const file of input.previous?.files ?? []) {
    if (file.sha256 !== null) previousHashes.set(file.path, file.sha256);
  }

  const files: ExportManifestFile[] = [];
  const keepEntry = (relativePath: string) => {
    const sha256 = previousHashes.get(relativePath);
    if (sha256 !== undefined) files.push({ path: relativePath, sha256 });
  };

  for (const file of input.planned) {
    if (file.kept) keepEntry(file.relativePath);
    else files.push({ path: file.relativePath, sha256: hashExportContent(file.content) });
  }
  for (const relativePath of input.keptRemovals) keepEntry(relativePath);

  return {
    version: EXPORT_MANIFEST_VERSION,
    sessionId: input.sessionId,
    revision: (input.previous?.revision ?? 0) + 1,
    scoutCommit: input.scoutCommit,
    headCommit: input.headCommit,
    files,
  };
}

/** The manifest file's content. */
export function renderExportManifest(manifest: ExportManifestV2): string {
  return `${JSON.stringify(manifest, null, 2)}\n`;
}

function isSha256(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{64}$/.test(value);
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

/**
 * A manifest's content, read as either version, or null when it is not a
 * manifest Grill Room wrote (unparseable JSON, an unknown version, or any
 * malformed field). Null means "no previous export": a manifest is never
 * guessed at. Content with no `version` is read as version 1.
 */
export function parseExportManifest(content: string): ParsedExportManifest | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;
  const record = parsed as Record<string, unknown>;
  const files = record.files;
  if (!Array.isArray(files)) return null;

  if (record.version === undefined || record.version === 1) {
    if (!files.every((file) => typeof file === "string")) return null;
    return {
      version: 1,
      sessionId: null,
      revision: 0,
      scoutCommit: null,
      headCommit: null,
      files: (files as string[]).map((file) => ({ path: file, sha256: null })),
    };
  }

  if (record.version !== 2) return null;
  const { sessionId, revision, scoutCommit, headCommit } = record;
  if (typeof sessionId !== "string") return null;
  if (typeof revision !== "number" || !Number.isInteger(revision) || revision < 1) return null;
  if (!isNullableString(scoutCommit) || !isNullableString(headCommit)) return null;
  const entries: ExportManifestFile[] = [];
  for (const file of files) {
    if (typeof file !== "object" || file === null) return null;
    const { path, sha256 } = file as Record<string, unknown>;
    if (typeof path !== "string" || !isSha256(sha256)) return null;
    entries.push({ path, sha256 });
  }
  return { version: 2, sessionId, revision, scoutCommit, headCommit, files: entries };
}

export interface PlanExportInput {
  sessionTitle: string;
  /** The session's idea, verbatim — `intent.md` opens with it unchanged. */
  idea: string;
  specMarkdown: string;
  /** Tickets to export, already in ascending number order. Empty when tickets are not being exported. */
  tickets: readonly ExportTicket[];
  /** The session's whole design tree, states resolved; `decisions.md` is rendered from it. */
  decisions: readonly DecisionView[];
  /**
   * The session's stored readiness judgment, or null when it has none.
   * `intent.md` renders it only when it was judged for `idea` — this is
   * checked again here even though a caller following `currentReadiness`'s
   * own idea rule has usually already filtered it, so the fallback text is
   * correct however the value was produced.
   */
  readiness: StoredReadiness | null;
  /** The session's current scout report with staleness, or null when it has never been scouted. */
  scoutReport: ScoutReportWithStaleness | null;
}

/** Lowercase; anything not a letter or digit collapses to one hyphen; leading/trailing hyphens trimmed. */
function slugify(input: string, maxLength: number): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, maxLength)
    .replace(/-+$/g, "");
}

/** At most this many words of the session title make up the proposed slug. */
export const PROPOSED_SLUG_MAX_WORDS = 4;

/** Longest slug accepted, after sanitizing. */
export const MAX_SLUG_LENGTH = 60;

/**
 * The slug proposed for a session's bundle: the session title lowercased and
 * split into words on every run of characters that are not ASCII letters or
 * digits, keeping the first {@link PROPOSED_SLUG_MAX_WORDS} words joined by
 * hyphens (then capped at {@link MAX_SLUG_LENGTH} characters). "Export anywhere
 * and generate a handoff" proposes `export-anywhere-and-generate`. Falls back
 * to `session-<first 8 of the id>` when the title has no usable word.
 */
export function proposeSlug(title: string, sessionId: string): string {
  const words = title
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length > 0)
    .slice(0, PROPOSED_SLUG_MAX_WORDS);
  const slug = slugify(words.join("-"), MAX_SLUG_LENGTH);
  return slug.length > 0 ? slug : `session-${sessionId.slice(0, 8)}`;
}

/**
 * A slug as the operator typed it, made safe for a folder name: lowercased,
 * every run of characters that are not ASCII letters or digits collapsed to
 * one hyphen, leading and trailing hyphens trimmed, at most {@link
 * MAX_SLUG_LENGTH} characters. Returns `""` when nothing usable remains; the
 * caller refuses that.
 */
export function sanitizeSlug(rawSlug: string): string {
  return slugify(rawSlug, MAX_SLUG_LENGTH);
}

/** A date as local `YYYY-MM-DD`, the value of the `{date}` placeholder. */
export function formatLocalDate(date: Date): string {
  const year = String(date.getFullYear()).padStart(4, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/**
 * The `{seq}` value for a new bundle: one more than the highest numeric prefix
 * (leading digits) among the names already in the export folder, zero-padded
 * to two digits — `01` when no name starts with a digit.
 */
export function nextSequence(existingNames: readonly string[]): string {
  let highest = 0;
  for (const name of existingNames) {
    const match = /^(\d+)/.exec(name);
    if (match) highest = Math.max(highest, Number(match[1]));
  }
  return String(highest + 1).padStart(2, "0");
}

export interface SlugPatternValues {
  slug: string;
  date: string;
  seq: string;
}

/**
 * The bundle's folder name: the project's slug pattern with every `{slug}`,
 * `{date}` and `{seq}` replaced by its value. Anything else in the pattern is
 * kept literally.
 */
export function applySlugPattern(pattern: string, values: SlugPatternValues): string {
  return pattern
    .split("{slug}")
    .join(values.slug)
    .split("{date}")
    .join(values.date)
    .split("{seq}")
    .join(values.seq);
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * For a pattern containing `{seq}`, the existing folder that is this same
 * bundle exported before: one whose name matches the pattern with `{seq}` as
 * any run of digits and `{slug}` and `{date}` as their current values. When
 * several match, the highest number wins. Null for a pattern without `{seq}`
 * or when none matches. This is what lets a re-export land in the folder it
 * wrote last time instead of taking the next number.
 */
export function findSequencedFolder(
  pattern: string,
  values: Omit<SlugPatternValues, "seq">,
  existingNames: readonly string[],
): string | null {
  if (!pattern.includes("{seq}")) return null;

  const source = pattern
    .split(/(\{slug\}|\{date\}|\{seq\})/)
    .map((part) => {
      if (part === "{seq}") return "(\\d+)";
      if (part === "{slug}") return escapeRegExp(values.slug);
      if (part === "{date}") return escapeRegExp(values.date);
      return escapeRegExp(part);
    })
    .join("");
  const matcher = new RegExp(`^${source}$`);

  let best: { name: string; number: number } | null = null;
  for (const name of existingNames) {
    const match = matcher.exec(name);
    if (!match) continue;
    const number = Math.max(...match.slice(1).map(Number));
    if (!best || number > best.number) best = { name, number };
  }
  return best?.name ?? null;
}

/**
 * A ticket slug re-sanitized for use in a file name. A ticket's slug is
 * validated when tickets are generated (`validateTicketSet`), but export does
 * not trust that: a row can be edited or arranged directly in the database,
 * so this collapses anything that is not a lowercase letter, digit or hyphen —
 * which also destroys `.` and `/`, so a slug like `../../evil` sanitizes down
 * to `evil` rather than escaping the bundle directory.
 */
export function sanitizeTicketSlug(rawSlug: string, ticketNumber: number): string {
  const slug = slugify(rawSlug, 200);
  return slug.length > 0 ? slug : `ticket-${ticketNumber}`;
}

/** Zero-padded ticket number: two digits, or three once the set holds 100 or more tickets. */
export function padTicketNumber(number: number, totalTickets: number): string {
  const width = totalTickets >= 100 ? 3 : 2;
  return String(number).padStart(width, "0");
}

/**
 * `spec.md`'s content: the spec markdown preceded by a `# <session title>`
 * heading and a `Status: ready-for-agent` line — unless the markdown already
 * starts with a level-1 heading, in which case only the status line is
 * inserted right after it.
 */
export function renderSpecFile(sessionTitle: string, specMarkdown: string): string {
  const headingMatch = /^# .*(?:\r?\n|$)/.exec(specMarkdown);

  if (headingMatch) {
    const heading = headingMatch[0].replace(/\r?\n$/, "");
    const rest = specMarkdown.slice(headingMatch[0].length).replace(/^\r?\n+/, "");
    return `${heading}\n\n${STATUS_LINE}\n\n${rest}`;
  }

  return `# ${sessionTitle}\n\n${STATUS_LINE}\n\n${specMarkdown}`;
}

/**
 * One ticket file's content: `# <NN> <title>`, blank line, `Status:`, then
 * `Blocked by:` (numbers padded the same as the file name, or `none`), blank
 * line, then the ticket body.
 */
export function renderTicketFile(params: {
  label: string;
  title: string;
  body: string;
  blockedByLabels: readonly string[];
}): string {
  const blockedByLine =
    params.blockedByLabels.length > 0
      ? `Blocked by: ${params.blockedByLabels.join(", ")}`
      : "Blocked by: none";

  return `# ${params.label} ${params.title}\n\n${STATUS_LINE}\n${blockedByLine}\n\n${params.body}`;
}

/** A decision's anchor and tie-break: its key, or its id for a row that has none. */
function decisionKey(decision: DecisionView): string {
  return decision.key ?? decision.id;
}

function byKey(a: DecisionView, b: DecisionView): number {
  const left = decisionKey(a);
  const right = decisionKey(b);
  return left < right ? -1 : left > right ? 1 : 0;
}

/**
 * Every decision in topological order, prerequisites first, ties broken by
 * key, so an unchanged tree always renders the same order. A dependency on an
 * id outside the set is ignored; anything left on a cycle (which validation
 * never lets into a tree) follows in key order.
 */
function topologicalOrder(decisions: readonly DecisionView[]): DecisionView[] {
  const ids = new Set(decisions.map((decision) => decision.id));
  const placed = new Set<string>();
  const remaining = [...decisions].sort(byKey);
  const ordered: DecisionView[] = [];

  while (remaining.length > 0) {
    const index = remaining.findIndex((decision) =>
      decision.dependsOn.every((id) => !ids.has(id) || placed.has(id)),
    );
    const [next] = remaining.splice(index === -1 ? 0 : index, 1);
    ordered.push(next!);
    placed.add(next!.id);
  }
  return ordered;
}

function oneLine(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/** A `- **Label:** value` list item; a multi-line value continues indented under it. */
function field(label: string, value: string): string {
  return `- **${label}:** ${value.trim().split(/\r?\n/).join("\n  ")}`;
}

/** The offered choice whose text equals the answer, or null when it matches none. */
function matchingChoice(decision: DecisionView) {
  const answer = decision.answer?.text?.trim() ?? "";
  if (answer.length === 0) return null;
  return decision.choices.find((choice) => choice.label.trim() === answer) ?? null;
}

/**
 * The offered choice an accepted recommendation picked, by its stored index, or
 * null when the answer is not an accepted recommendation or has no such choice.
 * Accepting stores the recommendation's reasoning as the answer text, not the
 * label, so the index is what names the choice.
 */
function recommendedChoiceAccepted(decision: DecisionView) {
  if (decision.answer?.kind !== "accepted-recommendation") return null;
  if (decision.recommendedChoice == null) return null;
  return decision.choices[decision.recommendedChoice] ?? null;
}

function isSettledAs(decision: DecisionView, kinds: readonly string[]): boolean {
  return decision.state === "settled" && decision.answer != null && kinds.includes(decision.answer.kind);
}

/** A full entry: a settled real answer, including a repo decision the interview reopened. */
function isEntry(decision: DecisionView): boolean {
  return isSettledAs(decision, ["accepted-recommendation", "own-answer"]);
}

function isDispositionedTo(decision: DecisionView, target: "out-of-scope" | "open-question"): boolean {
  return isSettledAs(decision, ["dispositioned"]) && decision.dispositionTarget === target;
}

/** A repo decision the user kept as it stands. */
function isBuiltUnder(decision: DecisionView): boolean {
  return isSettledAs(decision, ["repo-established"]);
}

function originLabel(decision: DecisionView): string {
  if (decision.introducedBy === "repo") {
    return `repo (${decision.repo?.source ?? "inferred"}) · reopened`;
  }
  const how =
    decision.answer?.kind === "accepted-recommendation"
      ? "accepted recommendation"
      : matchingChoice(decision)
        ? "another offered option"
        : "own answer";
  return `${decision.introducedBy} · ${how}`;
}

function dependencyReference(dependency: DecisionView): string | null {
  if (isEntry(dependency)) {
    return `[${oneLine(dependency.questionTitle)}](#${decisionKey(dependency)})`;
  }
  if (isBuiltUnder(dependency)) {
    return `\`${decisionKey(dependency)}\` (${dependency.repo?.citation ?? ""})`;
  }
  if (isDispositionedTo(dependency, "open-question")) {
    return `${oneLine(dependency.questionTitle)} (open question, see spec)`;
  }
  if (isDispositionedTo(dependency, "out-of-scope")) {
    return `${oneLine(dependency.questionTitle)} (out of scope)`;
  }
  return null;
}

function renderEntry(
  decision: DecisionView,
  order: ReadonlyMap<string, number>,
  byId: ReadonlyMap<string, DecisionView>,
): string {
  const lines = [
    `<a id="${decisionKey(decision)}"></a>`,
    `### ${oneLine(decision.questionTitle)}`,
    "",
  ];

  const recommended = recommendedChoiceAccepted(decision);
  if (recommended) {
    lines.push(field("Decision", recommended.label));
    if (recommended.rationale.trim().length > 0) {
      lines.push(field("Why (interviewer's case)", recommended.rationale));
    }
    const note = (decision.recommendedAnswer ?? decision.answer?.text ?? "").trim();
    if (note.length > 0 && note !== recommended.label.trim()) {
      lines.push(field("Recommendation note (interviewer's)", note));
    }
  } else {
    lines.push(field("Decision", decision.answer?.text ?? ""));
    const choice = matchingChoice(decision);
    if (choice && choice.rationale.trim().length > 0) {
      lines.push(field("Why (interviewer's case)", choice.rationale));
    }
  }

  lines.push(field("Origin", originLabel(decision)));

  const dependencies = decision.dependsOn
    .map((id) => byId.get(id))
    .filter((dependency): dependency is DecisionView => dependency !== undefined)
    .sort((a, b) => order.get(a.id)! - order.get(b.id)!)
    .map(dependencyReference)
    .filter((reference): reference is string => reference !== null);
  if (dependencies.length > 0) lines.push(field("Depends on", dependencies.join(", ")));

  if (decision.introducedBy === "repo" && decision.repo) {
    lines.push(field("Source", decision.repo.citation));
    lines.push(field("Supersedes", `"${oneLine(decision.repo.statement)}"`));
  }

  return lines.join("\n");
}

/**
 * `decisions.md`'s content, rendered from the session's tree with no model
 * call, or null when the session settled nothing of its own and set nothing
 * out of scope (kept repo decisions alone do not make a file).
 *
 * Three sections, each omitted when empty and each in topological order with
 * key ties:
 *
 * - **Decisions**: one entry per settled accepted recommendation or own answer,
 *   a reopened repo decision included, under an anchor named by its key.
 * - **Out of scope**: every loose end dispositioned out of scope, with its note.
 * - **Built under**: every kept repo decision, as key and citation only.
 *
 * Anything not settled, set aside as an open question, withdrawn or unplaced
 * appears nowhere, except that a dependency on an open question is named as one.
 */
export function renderDecisionsFile(
  sessionTitle: string,
  decisions: readonly DecisionView[],
): string | null {
  const ordered = topologicalOrder(decisions);
  const order = new Map(ordered.map((decision, index) => [decision.id, index]));
  const byId = new Map(decisions.map((decision) => [decision.id, decision]));

  const entries = ordered.filter(isEntry);
  const outOfScope = ordered.filter((decision) => isDispositionedTo(decision, "out-of-scope"));
  const builtUnder = ordered.filter(isBuiltUnder);

  if (entries.length === 0 && outOfScope.length === 0) return null;

  const sections = [
    `# Decisions: ${oneLine(sessionTitle)}`,
    "Generated by the Grill Room export from this session's settled design tree.",
  ];

  if (entries.length > 0) {
    sections.push("## Decisions", ...entries.map((entry) => renderEntry(entry, order, byId)));
  }

  if (outOfScope.length > 0) {
    sections.push(
      "## Out of scope",
      outOfScope
        .map((decision) => {
          const title = `- **${oneLine(decision.questionTitle)}**`;
          const note = decision.answer?.text?.trim() ?? "";
          return note.length > 0 ? `${title}: ${note.split(/\r?\n/).join("\n  ")}` : title;
        })
        .join("\n"),
    );
  }

  if (builtUnder.length > 0) {
    sections.push(
      "## Built under",
      builtUnder
        .map((decision) => `- \`${decisionKey(decision)}\`: ${decision.repo?.citation ?? ""}`)
        .join("\n"),
    );
  }

  return `${sections.join("\n\n")}\n`;
}

type ReadinessEvidenceItem = StoredReadiness["result"]["evidence"][number];
type ScoutCurrentStateItem = ScoutReportWithStaleness["result"]["currentState"][number];

function evidenceLine(item: ReadinessEvidenceItem): string {
  return item.source === "repo"
    ? `- ${item.text} · the repo shows (${item.citation})`
    : `- ${item.text} · the user said`;
}

/**
 * `intent.md`'s "Readiness before the interview" section: the readiness
 * judgment made on the idea before the first question was asked, labeled as
 * that snapshot with the time it was judged (`readiness.judgedAt`) — never a
 * re-judgment. Then the objective, expected outcome and verdict; for a
 * not-ready verdict, a line pointing at decisions.md and spec.md for what the
 * interview worked through; then the evidence (each item marked as the
 * user's or the repo's, a repo item with its citation), then the unknowns.
 * Exactly "Not judged for this version of the idea." when `readiness` is
 * null or was judged for a different idea than `idea`.
 */
function renderReadinessSection(idea: string, readiness: StoredReadiness | null): string {
  if (readiness === null || readiness.ideaJudged !== idea) {
    return "## Readiness before the interview\n\nNot judged for this version of the idea.";
  }

  const { result } = readiness;
  const lines = [
    "## Readiness before the interview",
    "",
    `Judged at ${readiness.judgedAt}, on the idea as first written, before any question was asked.`,
    "",
    field("Objective", result.objective ?? "None stated."),
    field("Expected outcome", result.expectedOutcome ?? "None stated."),
    field("Verdict", result.verdict),
  ];

  if (result.verdict === "not-ready") {
    lines.push(
      "",
      "The interview that followed worked through what this judgment lacked; decisions.md and spec.md hold the result.",
    );
  }

  if (result.evidence.length > 0) {
    lines.push("", "**Evidence**", "", ...result.evidence.map(evidenceLine));
  }
  if (result.unknowns.length > 0) {
    lines.push("", "**Unknowns**", "", ...result.unknowns.map((unknown) => `- ${unknown}`));
  }

  return lines.join("\n");
}

function statusLabel(status: ScoutCurrentStateItem["status"]): string {
  return status === "built" ? "Built" : status === "partial" ? "Partial" : "Gap";
}

function currentStateLine(item: ScoutCurrentStateItem): string {
  return `- **${statusLabel(item.status)}:** ${item.summary} (${item.citations.join(", ")})`;
}

/**
 * `intent.md`'s "Project state" section: each current-state item from the
 * scout report with its citation, then the commit it read. Null (the section
 * is left out) when the session has never been scouted; a note is added when
 * the report is stale.
 */
function renderProjectStateSection(scoutReport: ScoutReportWithStaleness | null): string | null {
  if (scoutReport === null) return null;

  const lines = [
    "## Project state",
    "",
    ...scoutReport.result.currentState.map(currentStateLine),
    "",
    field("Commit read", scoutReport.commitRead ?? "none"),
  ];
  if (scoutReport.stale) {
    lines.push("", "The project has changed since this report was read.");
  }
  return lines.join("\n");
}

/**
 * `intent.md`'s content: the why, for people, rendered from stored data with
 * no model call — the idea verbatim, the readiness judgment (or its "not
 * judged" fallback), and the scout report's current project state (omitted
 * entirely when the session has never been scouted).
 */
export function renderIntentFile(
  sessionTitle: string,
  idea: string,
  readiness: StoredReadiness | null,
  scoutReport: ScoutReportWithStaleness | null,
): string {
  const sections = [
    `# Intent: ${oneLine(sessionTitle)}`,
    idea.trim(),
    renderReadinessSection(idea, readiness),
  ];

  const projectState = renderProjectStateSection(scoutReport);
  if (projectState !== null) sections.push(projectState);

  return `${sections.join("\n\n")}\n`;
}

/**
 * The full set of files an export would write, and their content, with no
 * filesystem access. `server/export-bundle.ts` resolves each `relativePath`
 * against the bundle directory and asserts containment before writing — see
 * `sanitizeTicketSlug` for why that is still checked even though this
 * function already sanitizes.
 */
export function planExport(input: PlanExportInput): ExportPlan {
  const totalTickets = input.tickets.length;

  const files: PlannedExportFile[] = [
    { relativePath: "spec.md", content: renderSpecFile(input.sessionTitle, input.specMarkdown) },
    {
      relativePath: INTENT_FILE,
      content: renderIntentFile(input.sessionTitle, input.idea, input.readiness, input.scoutReport),
    },
  ];

  const decisionsFile = renderDecisionsFile(input.sessionTitle, input.decisions);
  if (decisionsFile !== null) {
    files.push({ relativePath: DECISIONS_FILE, content: decisionsFile });
  }

  for (const ticket of input.tickets) {
    const label = padTicketNumber(ticket.number, totalTickets);
    const slug = sanitizeTicketSlug(ticket.slug, ticket.number);
    const blockedByLabels = [...ticket.blockedBy]
      .sort((a, b) => a - b)
      .map((number) => padTicketNumber(number, totalTickets));

    files.push({
      relativePath: `issues/${label}-${slug}.md`,
      content: renderTicketFile({
        label,
        title: ticket.title,
        body: ticket.body,
        blockedByLabels,
      }),
    });
  }

  return { files };
}
