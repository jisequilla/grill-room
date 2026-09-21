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

/**
 * The six states of a decision. Computed, never stored. `withdrawn` and
 * `unplaced` are terminal-ish housekeeping states outside the normal
 * settled/frontier/blocked/stale lifecycle: a withdrawn decision has left the
 * tree (a push back's response), and an unplaced one is a user-added decision
 * the interviewer has not yet placed with its dependencies.
 */
export type DerivedDecisionState =
  | "settled"
  | "frontier"
  | "blocked"
  | "stale"
  | "withdrawn"
  | "unplaced";

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

/** Answer kinds a decision holds while still open: steering moves, not answers. */
export const LOOSE_END_ANSWER_KINDS = [
  "unknown",
  "pushed-back",
  "deferred",
  "prototype-flagged",
] as const satisfies readonly DecisionAnswerKind[];

/** The answer kinds submitting a round can produce. */
export const ROUND_ANSWER_KINDS = [
  "accepted-recommendation",
  "own-answer",
  ...LOOSE_END_ANSWER_KINDS,
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
  /** Set once a push back's response withdraws, replaces, or restructures this decision. */
  withdrawnAt?: string | null;
  /** Set while a user-added decision awaits the interviewer's placement. */
  awaitingPlacementSince?: string | null;
}

/** Every transitive dependency of `id`. Cycle-safe, and tolerates dangling ids. */
export function transitiveDependencies(
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
 * A withdrawn decision (a push back's response left it) is always
 * **withdrawn**, and an unplaced one (a user-added decision the interviewer
 * has not yet placed) is always **unplaced**: neither takes part in the
 * settled/frontier/blocked/stale computation below, and a dependency link
 * pointing at a withdrawn decision counts as satisfied — it has left the tree,
 * so nothing should wait on it.
 *
 * Otherwise, a decision with a real answer is **settled** unless something it
 * depends on, directly or transitively, was reopened after it settled — then
 * it is **stale**. Anything without a real answer is **frontier** when every
 * dependency is settled (or withdrawn) and **blocked** otherwise. A dependency
 * id that matches no decision is treated as unsettled, so a dangling link
 * blocks rather than silently opening the frontier.
 */
export function deriveTreeStates(
  decisions: readonly TreeDecision[],
): Map<string, DerivedDecisionState> {
  const byId = new Map(decisions.map((decision) => [decision.id, decision]));
  const withdrawn = new Set(
    decisions.filter((decision) => decision.withdrawnAt != null).map((d) => d.id),
  );
  const unplaced = new Set(
    decisions
      .filter((decision) => decision.awaitingPlacementSince != null)
      .map((d) => d.id),
  );
  const settled = new Set<string>();
  const stale = new Set<string>();

  for (const decision of decisions) {
    if (withdrawn.has(decision.id) || unplaced.has(decision.id)) continue;
    if (!isSettlingAnswerKind(decision.answerKind)) continue;

    // A decision answered but never stamped is treated as settled at the dawn
    // of time, so any reopen at all unsettles it.
    const since = decision.settledAt ?? "";
    const disturbed = [...transitiveDependencies(decision.id, byId)].some(
      (dependencyId) => {
        if (withdrawn.has(dependencyId)) return false;
        const reopenedAt = byId.get(dependencyId)?.reopenedAt;
        return reopenedAt != null && reopenedAt > since;
      },
    );

    if (disturbed) stale.add(decision.id);
    else settled.add(decision.id);
  }

  const states = new Map<string, DerivedDecisionState>();
  for (const decision of decisions) {
    if (withdrawn.has(decision.id)) {
      states.set(decision.id, "withdrawn");
    } else if (unplaced.has(decision.id)) {
      states.set(decision.id, "unplaced");
    } else if (stale.has(decision.id)) {
      states.set(decision.id, "stale");
    } else if (settled.has(decision.id)) {
      states.set(decision.id, "settled");
    } else {
      const ready = decision.dependsOn.every(
        (dependencyId) =>
          settled.has(dependencyId) || withdrawn.has(dependencyId),
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

/**
 * The ids of every decision that belongs in the session's next round: on the
 * frontier, and never answered at all. This is what actually needs asking,
 * regardless of when or why the decision was added to the tree — a decision a
 * proposal marked `ask: false` because a dependency was still open belongs
 * here too, the moment that dependency settles and the frontier reaches it.
 *
 * Deliberately narrower than "frontier": a decision with a non-settling
 * answer (pushed back, deferred, unknown, prototype flagged) is also
 * frontier-derived, since it left the decision open, but re-surfacing those
 * is {@link deferredFrontierIds}'s concern (for `deferred`) or
 * {@link import("../actions/answer-decision.js")}'s (for the rest), not this
 * function's.
 *
 * Preserves the order given, so a caller that loads decisions oldest-first
 * gets oldest-first output.
 */
export function neverAnsweredFrontierIds(
  decisions: readonly TreeDecision[],
): string[] {
  const states = deriveTreeStates(decisions);
  return decisions
    .filter(
      (decision) =>
        decision.answerKind === null && states.get(decision.id) === "frontier",
    )
    .map((decision) => decision.id);
}

/**
 * The ids of every deferred decision whose dependencies have since settled: it
 * asked to be put off, and its moment has come back around. A caller opening
 * the next round includes these after {@link neverAnsweredFrontierIds}'s, so a
 * fresh question is never bumped by one the user already chose to postpone.
 *
 * Preserves the order given, like {@link neverAnsweredFrontierIds}.
 */
export function deferredFrontierIds(
  decisions: readonly TreeDecision[],
): string[] {
  const states = deriveTreeStates(decisions);
  return decisions
    .filter(
      (decision) =>
        decision.answerKind === "deferred" &&
        states.get(decision.id) === "frontier",
    )
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
  withdrawnAt: string | null;
  awaitingPlacementSince: string | null;
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

/** A stored row, reduced to the facts derivation and selection work from. */
export function toTreeDecision(row: DecisionRow): TreeDecision {
  return {
    id: row.id,
    dependsOn: parseStringArray(row.dependsOnJson),
    answerKind: row.answerKind,
    settledAt: row.settledAt,
    reopenedAt: row.reopenedAt,
    withdrawnAt: row.withdrawnAt,
    awaitingPlacementSince: row.awaitingPlacementSince,
  };
}

/** {@link toTreeDecision} over a whole session's rows. */
export function treeFacts(rows: readonly DecisionRow[]): TreeDecision[] {
  return rows.map(toTreeDecision);
}

/** Turns stored rows into the shape read actions return, states included. */
export function describeDecisions(
  rows: readonly DecisionRow[],
): DecisionView[] {
  const states = deriveTreeStates(treeFacts(rows));

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
    withdrawnAt: row.withdrawnAt,
    awaitingPlacementSince: row.awaitingPlacementSince,
    createdAt: row.createdAt,
  }));
}

/**
 * An existing decision, as validation sees it: derivation's facts, its key,
 * and its question, so a push back's response can be checked against it.
 */
export interface KeyedTreeDecision extends TreeDecision {
  key: string | null;
  title: string;
  body: string;
}

/**
 * A decision the interviewer proposes. `dependsOn` holds keys, not ids. `title`
 * and `body` are optional because most callers of {@link validateProposal}
 * only need the graph shape; they are read when the proposal is a response to
 * a push back, to catch an unchanged re-ask.
 */
export interface ProposedDecision {
  key: string;
  title?: string;
  body?: string;
  dependsOn: readonly string[];
  ask: boolean;
}

/**
 * The interviewer's response to one pushed-back decision, as validation needs
 * it. A `replacementKey` names a decision in the same proposal's
 * `proposedDecisions`.
 */
export interface ProposedPushBackResponse {
  decisionKey: string;
  response: "withdraw" | "replace" | "restructure";
  replacementKey: string | null;
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
 * Refused: a key that already exists or is proposed twice, a dependency link
 * pointing at nothing, links that form a cycle, a question marked to be asked
 * that is not on the frontier once the proposal's own new decisions are part
 * of the tree, a pending push back with no response, a response that re-asks
 * the pushed-back decision unchanged, a user-added decision the proposal
 * leaves without a placement, and a placement for anything else.
 *
 * `pushBackResponses` and `userDecisionPlacements` default to empty, so a
 * caller with nothing pending to check against them can omit both.
 */
export function validateProposal(
  existing: readonly KeyedTreeDecision[],
  proposed: readonly ProposedDecision[],
  extra: {
    pushBackResponses?: readonly ProposedPushBackResponse[];
    userDecisionPlacements?: readonly ProposedDecision[];
  } = {},
): ProposalValidation {
  const pushBackResponses = extra.pushBackResponses ?? [];
  const userDecisionPlacements = extra.userDecisionPlacements ?? [];
  const reasons: string[] = [];

  const existingIdByKey = new Map<string, string>();
  const existingByKey = new Map<string, KeyedTreeDecision>();
  for (const decision of existing) {
    if (decision.key == null) continue;
    existingIdByKey.set(decision.key, decision.id);
    existingByKey.set(decision.key, decision);
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

  for (const placement of userDecisionPlacements) {
    for (const dependencyKey of placement.dependsOn) {
      if (
        !existingIdByKey.has(dependencyKey) &&
        !proposedKeys.has(dependencyKey)
      ) {
        reasons.push(
          `Decision "${placement.key}" depends on "${dependencyKey}", which is neither an existing decision nor part of this proposal.`,
        );
      }
    }
  }

  // A pending push back or an awaiting placement is a loose end the proposal
  // must close, the same way an unanswered card blocks a round's submission.
  const pendingPushBackKeys = existing
    .filter(
      (decision) =>
        decision.key != null &&
        decision.answerKind === "pushed-back" &&
        decision.withdrawnAt == null,
    )
    .map((decision) => decision.key as string);
  const respondedKeys = new Set(
    pushBackResponses.map((response) => response.decisionKey),
  );
  for (const key of pendingPushBackKeys) {
    if (!respondedKeys.has(key)) {
      reasons.push(
        `Decision "${key}" was pushed back and needs a response in \`pushBackResponses\`: withdraw it, replace it, or restructure the part of the tree it sat in.`,
      );
    }
  }

  const awaitingPlacementKeys = existing
    .filter(
      (decision) =>
        decision.key != null && decision.awaitingPlacementSince != null,
    )
    .map((decision) => decision.key as string);
  const placedKeys = new Set(
    userDecisionPlacements.map((placement) => placement.key),
  );
  for (const key of awaitingPlacementKeys) {
    if (!placedKeys.has(key)) {
      reasons.push(
        `Decision "${key}" was added by the user and needs a placement in \`userDecisionPlacements\`: its dependencies, recommended answer, choices and whether to ask it now.`,
      );
    }
  }
  for (const placement of userDecisionPlacements) {
    if (!awaitingPlacementKeys.includes(placement.key)) {
      reasons.push(
        `"${placement.key}" in \`userDecisionPlacements\` is not a decision awaiting placement.`,
      );
    }
  }

  // Keys and links have to resolve before the graph means anything.
  if (reasons.length > 0) return { ok: false, reasons };

  const resolve = (key: string): string =>
    existingIdByKey.get(key) ?? proposedId(key);

  const placementByKey = new Map(
    userDecisionPlacements.map((placement) => [placement.key, placement]),
  );

  const combined: TreeDecision[] = [
    ...existing.map((decision) => {
      const placement = decision.key ? placementByKey.get(decision.key) : undefined;
      // A placement is what this validation is checking: simulate it applied,
      // so a placed decision can be judged frontier-ready like any other.
      return placement
        ? {
            ...decision,
            dependsOn: placement.dependsOn.map(resolve),
            awaitingPlacementSince: null,
          }
        : decision;
    }),
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

  for (const placement of userDecisionPlacements) {
    if (!placement.ask) continue;
    const id = existingIdByKey.get(placement.key);
    if (id == null || states.get(id) === "frontier") continue;

    const open = placement.dependsOn.filter((key) => !settledKeys.has(key));
    reasons.push(
      `Decision "${placement.key}" is marked to be asked but is not on the frontier: it depends on ${open
        .map((key) => `"${key}"`)
        .join(", ")}, which ${open.length === 1 ? "is" : "are"} not settled. Ask it in a later round, or set ask to false.`,
    );
  }

  for (const response of pushBackResponses) {
    if (response.response === "withdraw") continue;
    const original = existingByKey.get(response.decisionKey);
    if (!original) continue;

    const candidates = response.replacementKey
      ? proposed.filter((decision) => decision.key === response.replacementKey)
      : proposed;
    const unchanged = candidates.some(
      (decision) =>
        decision.title === original.title && decision.body === original.body,
    );
    if (unchanged) {
      reasons.push(
        `The response to pushed-back decision "${response.decisionKey}" re-asks it unchanged. Withdraw it, replace it with something different, or restructure the part of the tree it sat in.`,
      );
    }
  }

  return { ok: reasons.length === 0, reasons };
}
