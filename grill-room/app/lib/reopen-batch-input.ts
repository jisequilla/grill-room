/**
 * Turning a pasted comparison into a batch of reopens.
 *
 * The list of changes a user arrives with was written somewhere else — a
 * comparison document, a spreadsheet, a message — so this reads the two shapes
 * that come out of those: a two-column markdown table, and a JSON array. Each
 * row names a decision and the answer it should now have.
 *
 * Naming a decision is the awkward part. A key (`dashboard-access`) is exact
 * and is what the tree stores, but nobody writing a comparison by hand uses
 * keys; they write the question's title, and often only the start of it. So a
 * row resolves by key, then by exact title, then by a case-insensitive title
 * prefix — and only when exactly one decision matches that prefix. Anything
 * else comes back unresolved or ambiguous, for the preview to show and the
 * user to fix. Guessing between two decisions is the one thing this must not
 * do: the wrong guess rewrites a settled answer the user never meant to touch.
 */

/** One row as pasted: who to change, and what to. */
export interface ParsedBatchRow {
  /** The decision cell, exactly as written. */
  decision: string;
  answer: string;
}

/** Why a paste could not be read at all. */
export type BatchParseError = "empty" | "bad-json" | "no-rows";

export interface BatchParseResult {
  rows: ParsedBatchRow[];
  error: BatchParseError | null;
}

/** A decision, as resolving a row needs it. */
export interface ResolvableDecision {
  id: string;
  key: string | null;
  questionTitle: string;
  state: string;
}

export type BatchRowMatch = "key" | "title" | "prefix";

export interface ResolvedBatchRow extends ParsedBatchRow {
  /** The decision this row names, or null when nothing matched or too much did. */
  resolved: ResolvableDecision | null;
  /** How it was matched. Null when it was not. */
  match: BatchRowMatch | null;
  /** The titles that matched, when more than one did. Empty otherwise. */
  ambiguous: string[];
}

function isSeparatorRow(cells: readonly string[]): boolean {
  return cells.every((cell) => /^:?-{2,}:?$/.test(cell));
}

function isHeaderRow(cells: readonly string[]): boolean {
  const [first = "", second = ""] = cells;
  return (
    /^(decision|key|question|title)\b/i.test(first) &&
    /answer|decision|value/i.test(second)
  );
}

function cellsOf(line: string): string[] {
  return line
    .replace(/^\s*\|/, "")
    .replace(/\|\s*$/, "")
    .split("|")
    .map((cell) => cell.trim());
}

function parseJsonRows(text: string): BatchParseResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { rows: [], error: "bad-json" };
  }

  if (!Array.isArray(parsed)) return { rows: [], error: "bad-json" };

  const rows: ParsedBatchRow[] = [];
  for (const entry of parsed) {
    if (!entry || typeof entry !== "object") continue;
    const record = entry as Record<string, unknown>;
    const decision = [
      record.decisionKey,
      record.decisionId,
      record.decision,
      record.title,
      record.key,
    ].find((value): value is string => typeof value === "string" && value.trim() !== "");
    const answer = [record.answer, record.newAnswer].find(
      (value): value is string => typeof value === "string",
    );
    if (decision === undefined || answer === undefined) continue;
    rows.push({ decision: decision.trim(), answer: answer.trim() });
  }

  return rows.length > 0 ? { rows, error: null } : { rows: [], error: "no-rows" };
}

/**
 * Read a pasted markdown table or JSON array into rows. Rows are kept exactly
 * as written; nothing is matched against the tree here.
 */
export function parseBatchInput(text: string): BatchParseResult {
  const trimmed = text.trim();
  if (trimmed === "") return { rows: [], error: "empty" };
  if (trimmed.startsWith("[")) return parseJsonRows(trimmed);

  const rows: ParsedBatchRow[] = [];
  let headerSeen = false;

  for (const line of trimmed.split("\n")) {
    if (!line.includes("|")) continue;
    const cells = cellsOf(line);
    if (cells.length < 2) continue;
    if (isSeparatorRow(cells)) continue;
    if (!headerSeen && isHeaderRow(cells)) {
      headerSeen = true;
      continue;
    }

    const [decision = "", answer = ""] = cells;
    if (decision === "" && answer === "") continue;
    rows.push({ decision, answer });
  }

  return rows.length > 0 ? { rows, error: null } : { rows: [], error: "no-rows" };
}

/** Match each row against the tree, leaving the ones that cannot be matched visible. */
export function resolveBatchRows(
  rows: readonly ParsedBatchRow[],
  decisions: readonly ResolvableDecision[],
): ResolvedBatchRow[] {
  return rows.map((row) => {
    const needle = row.decision.trim();
    const lower = needle.toLowerCase();

    const byKey = decisions.find((decision) => decision.key === needle);
    if (byKey) return { ...row, resolved: byKey, match: "key", ambiguous: [] };

    const byTitle = decisions.find(
      (decision) => decision.questionTitle === needle,
    );
    if (byTitle) {
      return { ...row, resolved: byTitle, match: "title", ambiguous: [] };
    }

    const byPrefix =
      needle === ""
        ? []
        : decisions.filter((decision) =>
            decision.questionTitle.toLowerCase().startsWith(lower),
          );

    if (byPrefix.length === 1) {
      return {
        ...row,
        resolved: byPrefix[0] as ResolvableDecision,
        match: "prefix",
        ambiguous: [],
      };
    }

    return {
      ...row,
      resolved: null,
      match: null,
      ambiguous: byPrefix.map((decision) => decision.questionTitle),
    };
  });
}

/** The states a decision can be reopened from. Anything else needs the warning. */
const REOPENABLE_STATES: readonly string[] = ["settled", "stale"];

export function isReopenableState(state: string): boolean {
  return REOPENABLE_STATES.includes(state);
}

/** Rows that can be sent as they are: every one resolved. */
export function isApplicable(rows: readonly ResolvedBatchRow[]): boolean {
  return (
    rows.length > 0 &&
    rows.every((row) => row.resolved !== null && row.answer.trim() !== "")
  );
}
