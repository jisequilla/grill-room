/**
 * The shapes the workspace reads, taken from the actions themselves through the
 * generated action registry rather than restated by hand, so a change to
 * `get-tree` or `get-current-round` surfaces here as a type error.
 */

type TreeResult = AgentNativeActionRegistry["get-tree"]["result"];
type RoundResult = AgentNativeActionRegistry["get-current-round"]["result"];

/** One decision of the design tree, with its history. */
export type TreeDecision = TreeResult["decisions"][number];

/** One card of the open round: a decision plus whatever draft answer it holds. */
export type RoundCard = NonNullable<RoundResult["round"]>["decisions"][number];

export type DecisionState = TreeDecision["state"];
export type DecisionAnswerKind = NonNullable<TreeDecision["answer"]>["kind"];
export type TurnStatus = RoundResult["turnStatus"];

/** The answer kinds a round card can be given, in the order the card offers them. */
export const ROUND_ANSWER_KINDS = [
  "accepted-recommendation",
  "own-answer",
  "unknown",
  "pushed-back",
  "deferred",
  "prototype-flagged",
] as const satisfies readonly DecisionAnswerKind[];

export type RoundAnswerKind = (typeof ROUND_ANSWER_KINDS)[number];

/** Answers that leave the decision open, holding everything downstream blocked. */
const LOOSE_END_KINDS: readonly DecisionAnswerKind[] = [
  "unknown",
  "pushed-back",
  "deferred",
  "prototype-flagged",
];

/** A decision the user still owes a real answer, and can give one to right now. */
export function isLooseEnd(decision: {
  answer: { kind: DecisionAnswerKind } | null;
  withdrawnAt: string | null;
}): boolean {
  return (
    decision.withdrawnAt === null &&
    decision.answer !== null &&
    LOOSE_END_KINDS.includes(decision.answer.kind)
  );
}

export const DECISION_STATE_LABEL_KEY: Record<DecisionState, string> = {
  settled: "workspace.stateSettled",
  frontier: "workspace.stateFrontier",
  blocked: "workspace.stateBlocked",
  stale: "workspace.stateStale",
  withdrawn: "workspace.stateWithdrawn",
  unplaced: "workspace.stateUnplaced",
};

export const ANSWER_KIND_LABEL_KEY: Record<DecisionAnswerKind, string> = {
  "accepted-recommendation": "workspace.kindAcceptedRecommendation",
  "own-answer": "workspace.kindOwnAnswer",
  unknown: "workspace.kindUnknown",
  "pushed-back": "workspace.kindPushedBack",
  deferred: "workspace.kindDeferred",
  "prototype-flagged": "workspace.kindPrototypeFlagged",
  dispositioned: "workspace.kindDispositioned",
};

/**
 * The `errorCode` an action attached to a failure, when it attached one. The
 * framework hangs it off the thrown `Error`; nothing in its public types names
 * the field.
 */
export function actionErrorCode(error: unknown): string | undefined {
  if (error instanceof Error && "errorCode" in error) {
    const code = (error as { errorCode?: unknown }).errorCode;
    if (typeof code === "string") return code;
  }
  return undefined;
}
