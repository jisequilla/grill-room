import type {
  BreakIntoTicketsResult,
  OfferedChoice,
  ProposeRoundResult,
  RequestKind,
  ReviewStaleResult,
  SynthesizeSpecResult,
} from "./schemas.js";

/** Models the interview can run on. These are the command line's `--model` values. */
export type InterviewerModel = "fable" | "opus" | "sonnet";

export const INTERVIEWER_MODELS: readonly InterviewerModel[] = [
  "fable",
  "opus",
  "sonnet",
];

/** How a decision was answered. Only the first two and the dispositions settle it. */
export type AnswerKind =
  | "accepted-recommendation"
  | "own-answer"
  | "unknown"
  | "pushed-back"
  | "deferred"
  | "prototype-flagged"
  | "out-of-scope"
  | "open-question";

/** Computed by the app, never by the interviewer. Sent so the model can see the tree. */
export type DecisionState = "settled" | "frontier" | "blocked" | "stale";

export interface DecisionAnswer {
  kind: AnswerKind;
  /** The answer, the reason for a push back, or what a prototype taught. */
  text: string;
}

/** One decision of the design tree, as the app currently holds it. */
export interface DecisionSnapshot {
  key: string;
  title: string;
  body: string;
  /** The choices offered, each with the case for it. */
  choices: OfferedChoice[];
  /** Which of `choices` the recommendation picked, or null when none of them. */
  recommendedChoice: number | null;
  recommendedAnswer: string;
  dependsOn: string[];
  state: DecisionState;
  answer: DecisionAnswer | null;
  /** Earlier answers, kept when the decision was reopened, re-asked or reconfirmed. */
  previousAnswers: DecisionAnswer[];
  introducedBy: "interviewer" | "user";
}

/**
 * Everything the interviewer needs about the session, whatever the request kind.
 * The port holds no state and reads no tables: this is its whole view of the world.
 */
export interface InterviewContext {
  /** The loose idea the session started from. */
  idea: string;
  title: string | null;
  model: InterviewerModel;
  answeringMode: "whole-round" | "one-at-a-time";
  /** The conversation to resume, or null to start a new one. */
  conversationId: string | null;
  /** Every decision in the tree, in the order the app wants them read. */
  decisions: DecisionSnapshot[];
}

/** One answer from the round just submitted. A push back arrives as `pushed-back`. */
export interface SubmittedAnswer {
  decisionKey: string;
  kind: AnswerKind;
  text: string;
}

/** A decision the user added, for the interviewer to place in the tree. */
export interface UserAddedDecision {
  key: string;
  title: string;
  body: string;
}

interface RequestBase {
  context: InterviewContext;
  /**
   * Why the app rejected the previous attempt at this same request, when this
   * is a retry. The app enforces the frontier rule, cycles and dangling links;
   * the port only passes the reason back to the model.
   */
  rejectionReason: string | null;
}

export interface ProposeRoundRequest extends RequestBase {
  kind: "propose-round";
  /** The answers of the round just submitted. Empty on the first turn. */
  latestAnswers: SubmittedAnswer[];
  userAddedDecisions: UserAddedDecision[];
}

export interface ReviewStaleRequest extends RequestBase {
  kind: "review-stale";
  /** The decision the user reopened. Its new answer is in the context. */
  reopenedDecisionKey: string;
  /** The stale decisions to rule on, in the order they should be reported. */
  staleDecisionKeys: string[];
}

export interface SynthesizeSpecRequest extends RequestBase {
  kind: "synthesize-spec";
  /** Loose ends the user moved out of scope, for the spec's Out of Scope section. */
  outOfScope: string[];
  /** Loose ends the user kept as named open questions, for Further Notes. */
  openQuestions: string[];
}

export interface BreakIntoTicketsRequest extends RequestBase {
  kind: "break-into-tickets";
  specMarkdown: string;
}

export type InterviewerRequest =
  | ProposeRoundRequest
  | ReviewStaleRequest
  | SynthesizeSpecRequest
  | BreakIntoTicketsRequest;

/** A request narrowed to one kind, for generic code over the four kinds. */
export type RequestFor<Kind extends RequestKind> = Extract<
  InterviewerRequest,
  { kind: Kind }
>;

export interface InterviewerTurn<Result> {
  result: Result;
  /** Store this on the session and pass it back as `conversationId` next turn. */
  conversationId: string;
}

/**
 * The interviewer port. The only place the app talks to Claude.
 *
 * Every method either resolves with a schema-valid result or rejects with an
 * {@link import("./errors.js").InterviewerError}. The port guarantees nothing
 * beyond schema validity: the frontier rule, cycles and dangling dependency
 * links are the app's to enforce on the result.
 */
export interface Interviewer {
  proposeRound(
    request: ProposeRoundRequest,
  ): Promise<InterviewerTurn<ProposeRoundResult>>;
  reviewStale(
    request: ReviewStaleRequest,
  ): Promise<InterviewerTurn<ReviewStaleResult>>;
  synthesizeSpec(
    request: SynthesizeSpecRequest,
  ): Promise<InterviewerTurn<SynthesizeSpecResult>>;
  breakIntoTickets(
    request: BreakIntoTicketsRequest,
  ): Promise<InterviewerTurn<BreakIntoTicketsResult>>;
}
