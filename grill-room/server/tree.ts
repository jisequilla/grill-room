/**
 * The design tree's rules, as pure functions over decisions and dependency
 * links. Nothing here reads a table, calls the interviewer, or knows what time
 * it is: actions load rows, hand them here, and write back what comes out.
 *
 * Two things live here. **Derivation** turns the raw facts a decision carries —
 * its answer kind, when it settled, when it was reopened — into the four states
 * the user sees, so the tree is always computed rather than claimed by the
 * interviewer. **Validation** decides whether a proposed round may be stored at
 * all: it is the app's guarantee that no question is asked while something it
 * depends on is still open.
 *
 * Tested through the actions that use it, never directly.
 */
import type { decisions, DecisionAnswerKind } from "./db/schema.js";

/** The four states of a decision. Computed, never stored. */
export type DerivedDecisionState = "settled" | "frontier" | "blocked" | "stale";

/**
 * Answer kinds that count as a real answer. Unknown, pushed back, deferred and
 * prototype flagged are deliberately absent: they are answers the user gave,
 * but they leave the decision open and hold everything downstream blocked.
 */
export const SETTLING_ANSWER_KINDS = [
  "accepted-recommendation",
  "own-answer",
  "dispositioned",
] as const satisfies readonly DecisionAnswerKind[];

/** The answer kinds submitting a round can produce. */
export const ROUND_ANSWER_KINDS = [
  "accepted-recommendation",
  "own-answer",
] as const satisfies readonly DecisionAnswerKind[];

export type RoundAnswerKind = (typeof ROUND_ANSWER_KINDS)[number];

export function isSettlingAnswerKind(
  kind: DecisionAnswerKind | null | undefined,
): boolean {
  return (
    kind != null && (SETTLING_ANSWER_KINDS as readonly string[]).includes(kind)
  );
}

/** The facts derivation needs. Any row with these fields will do. */
export interface TreeDecision {
  id: string;
  /** Ids of the decisions this one hangs off. */
  dependsOn: readonly string[];
  answerKind: DecisionAnswerKind | null;
  settledAt: string | null;
  reopenedAt: string | null;
}

/** Every transitive dependency of `id`. Cycle-safe, and tolerates dangling ids. */
function transitiveDependencies(
  id: string,
  byId: ReadonlyMap<string, TreeDecision>,
): Set<string> {
  const seen = new Set<string>();
  const queue = [...(byId.get(id)?.dependsOn ?? [])];

  while (queue.length > 0) {
    const next = queue.shift();
    if (next === undefined || seen.has(next)) continue;
    seen.add(next);
    const node = byId.get(next);
    if (node) queue.push(...node.dependsOn);
  }

  return seen;
}

/**
 * The state of every decision, by id.
 *
 * A decision with a real answer is **settled** unless something it depends on,
 * directly or transitively, was reopened after it settled — then it is
 * **stale**. Anything without a real answer is **frontier** when every
 * dependency is settled and **blocked** otherwise. A dependency id that matches
 * no decision is treated as unsettled, so a dangling link blocks rather than
 * silently opening the frontier.
 */
export function deriveTreeStates(
  decisions: readonly TreeDecision[],
): Map<string, DerivedDecisionState> {
  const byId = new Map(decisions.map((decision) => [decision.id, decision]));
  const settled = new Set<string>();
  const stale = new Set<string>();

  for (const decision of decisions) {
    if (!isSettlingAnswerKind(decision.answerKind)) continue;

    // A decision answered but never stamped is treated as settled at the dawn
    // of time, so any reopen at all unsettles it.
    const since = decision.settledAt ?? "";
    const disturbed = [...transitiveDependencies(decision.id, byId)].some(
      (dependencyId) => {
        const reopenedAt = byId.get(dependencyId)?.reopenedAt;
        return reopenedAt != null && reopenedAt > since;
      },
    );

    if (disturbed) stale.add(decision.id);
    else settled.add(decision.id);
  }

  const states = new Map<string, DerivedDecisionState>();
  for (const decision of decisions) {
    if (stale.has(decision.id)) {
      states.set(decision.id, "stale");
    } else if (settled.has(decision.id)) {
      states.set(decision.id, "settled");
    } else {
      const ready = decision.dependsOn.every((dependencyId) =>
        settled.has(dependencyId),
      );
      states.set(decision.id, ready ? "frontier" : "blocked");
    }
  }

  return states;
}

/** The ids of every decision that can be asked right now. */
export function frontierDecisionIds(
  decisions: readonly TreeDecision[],
): string[] {
  const states = deriveTreeStates(decisions);
  return decisions
    .filter((decision) => states.get(decision.id) === "frontier")
    .map((decision) => decision.id);
}

/** A stored decision, exactly as the table holds it. */
export type DecisionRow = typeof decisions.$inferSelect;

/** A decision as every read action reports it: the row with its state resolved. */
export interface DecisionView {
  id: string;
  key: string | null;
  questionTitle: string;
  questionBody: string;
  choices: string[];
  recommendedAnswer: string | null;
  /** Ids, not keys: the interviewer's keys never leave the interviewer port. */
  dependsOn: string[];
  introducedBy: DecisionRow["introducedBy"];
  state: DerivedDecisionState;
  answer: { text: string | null; kind: DecisionAnswerKind } | null;
  dispositionTarget: DecisionRow["dispositionTarget"];
  settledAt: string | null;
  reopenedAt: string | null;
  createdAt: string;
}

/** Reads a JSON string column that holds an array of strings. */
export function parseStringArray(json: string): string[] {
  try {
    const parsed: unknown = JSON.parse(json);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((entry): entry is string => typeof entry === "string");
  } catch {
    return [];
  }
}

/** Turns stored rows into the shape read actions return, states included. */
export function describeDecisions(
  rows: readonly DecisionRow[],
): DecisionView[] {
  const states = deriveTreeStates(
    rows.map((row) => ({
      id: row.id,
      dependsOn: parseStringArray(row.dependsOnJson),
      answerKind: row.answerKind,
      settledAt: row.settledAt,
      reopenedAt: row.reopenedAt,
    })),
  );

  return rows.map((row) => ({
    id: row.id,
    key: row.key,
    questionTitle: row.questionTitle,
    questionBody: row.questionBody,
    choices: parseStringArray(row.offeredChoicesJson),
    recommendedAnswer: row.recommendedAnswer,
    dependsOn: parseStringArray(row.dependsOnJson),
    introducedBy: row.introducedBy,
    state: states.get(row.id) ?? "blocked",
    answer: row.answerKind
      ? { text: row.currentAnswer, kind: row.answerKind }
      : null,
    dispositionTarget: row.dispositionTarget,
    settledAt: row.settledAt,
    reopenedAt: row.reopenedAt,
    createdAt: row.createdAt,
  }));
}

/** An existing decision, as validation sees it: derivation's facts plus its key. */
export interface KeyedTreeDecision extends TreeDecision {
  key: string | null;
}

/** A decision the interviewer proposes. `dependsOn` holds keys, not ids. */
export interface ProposedDecision {
  key: string;
  dependsOn: readonly string[];
  ask: boolean;
}

export interface ProposalValidation {
  ok: boolean;
  /** Empty when `ok`. Written for the interviewer: it is sent back verbatim. */
  reasons: string[];
}

/** Ids for proposed decisions, which have none yet. Existing ids are UUIDs. */
function proposedId(key: string): string {
  return `proposed:${key}`;
}

/** Reports every key on a cycle in the combined graph, in a stable order. */
function keysOnCycles(
  nodes: ReadonlyMap<string, { label: string; dependsOn: readonly string[] }>,
): string[] {
  const onCycle = new Set<string>();
  const done = new Set<string>();
  const onPath = new Set<string>();

  function visit(id: string, path: string[]): void {
    if (done.has(id)) return;
    if (onPath.has(id)) {
      for (const member of path.slice(path.indexOf(id))) onCycle.add(member);
      return;
    }

    onPath.add(id);
    path.push(id);
    for (const dependencyId of nodes.get(id)?.dependsOn ?? []) {
      if (nodes.has(dependencyId)) visit(dependencyId, path);
    }
    path.pop();
    onPath.delete(id);
    done.add(id);
  }

  for (const id of nodes.keys()) visit(id, []);

  return [...onCycle].map((id) => nodes.get(id)?.label ?? id);
}

/**
 * Whether a proposed round may be stored. A proposal is accepted or rejected
 * whole: partial storage would leave the tree describing a round that was never
 * asked.
 *
 * Four things are refused: a key that already exists or is proposed twice, a
 * dependency link pointing at nothing, links that form a cycle, and a question
 * marked to be asked that is not on the frontier once the proposal's own new
 * decisions are part of the tree.
 */
export function validateProposal(
  existing: readonly KeyedTreeDecision[],
  proposed: readonly ProposedDecision[],
): ProposalValidation {
  const reasons: string[] = [];

  const existingIdByKey = new Map<string, string>();
  for (const decision of existing) {
    if (decision.key != null) existingIdByKey.set(decision.key, decision.id);
  }

  const proposedKeys = new Set<string>();
  const duplicated = new Set<string>();
  for (const decision of proposed) {
    if (proposedKeys.has(decision.key)) duplicated.add(decision.key);
    proposedKeys.add(decision.key);
  }
  for (const key of duplicated) {
    reasons.push(`Decision "${key}" was proposed twice in the same round.`);
  }

  for (const decision of proposed) {
    if (existingIdByKey.has(decision.key)) {
      reasons.push(
        `Decision "${decision.key}" is already in the tree. Propose it under a new key, or leave it alone.`,
      );
    }
  }

  for (const decision of proposed) {
    for (const dependencyKey of decision.dependsOn) {
      if (
        !existingIdByKey.has(dependencyKey) &&
        !proposedKeys.has(dependencyKey)
      ) {
        reasons.push(
          `Decision "${decision.key}" depends on "${dependencyKey}", which is neither an existing decision nor part of this proposal.`,
        );
      }
    }
  }

  // Keys and links have to resolve before the graph means anything.
  if (reasons.length > 0) return { ok: false, reasons };

  const resolve = (key: string): string =>
    existingIdByKey.get(key) ?? proposedId(key);

  const combined: TreeDecision[] = [
    ...existing,
    ...proposed.map((decision) => ({
      id: proposedId(decision.key),
      dependsOn: decision.dependsOn.map(resolve),
      answerKind: null,
      settledAt: null,
      reopenedAt: null,
    })),
  ];

  const labelled = new Map(
    combined.map((decision) => [
      decision.id,
      {
        label:
          existing.find((candidate) => candidate.id === decision.id)?.key ??
          decision.id.replace(/^proposed:/, ""),
        dependsOn: decision.dependsOn,
      },
    ]),
  );

  const cycleKeys = keysOnCycles(labelled);
  if (cycleKeys.length > 0) {
    reasons.push(
      `These decisions form a dependency cycle: ${cycleKeys.sort().join(", ")}. Dependencies must point backwards only.`,
    );
    return { ok: false, reasons };
  }

  const states = deriveTreeStates(combined);
  const settledKeys = new Set(
    existing
      .filter(
        (decision) =>
          decision.key != null && states.get(decision.id) === "settled",
      )
      .map((decision) => decision.key as string),
  );

  for (const decision of proposed) {
    if (!decision.ask) continue;
    if (states.get(proposedId(decision.key)) === "frontier") continue;

    const open = decision.dependsOn.filter((key) => !settledKeys.has(key));
    reasons.push(
      `Decision "${decision.key}" is marked to be asked but is not on the frontier: it depends on ${open
        .map((key) => `"${key}"`)
        .join(", ")}, which ${open.length === 1 ? "is" : "are"} not settled. Ask it in a later round, or set ask to false.`,
    );
  }

  return { ok: reasons.length === 0, reasons };
}
