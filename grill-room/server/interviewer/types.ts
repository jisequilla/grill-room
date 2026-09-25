import type { ProjectServerFacts } from "../project-facts.js";
import type { InterviewerErrorCode } from "./errors.js";
import type {
  AssessReadinessResult,
  BreakIntoTicketsResult,
  FindSupersededResult,
  HandoffScoutResult,
  OfferedChoice,
  ProposeRoundResult,
  RequestKind,
  ReviewStaleResult,
  ScoutProjectResult,
  SynthesizeSpecResult,
} from "./schemas.js";

/** Models the interview can run on. These are the command line's `--model` values. */
export type InterviewerModel = "fable" | "opus" | "sonnet";

export const INTERVIEWER_MODELS: readonly InterviewerModel[] = [
  "fable",
  "opus",
  "sonnet",
];

/**
 * How a decision was answered. Only the first two, the dispositions and
 * `repo-established` settle it. `repo-established` is a repo decision the user
 * kept from the scout report: the project's statement is its answer.
 */
export type AnswerKind =
  | "accepted-recommendation"
  | "own-answer"
  | "unknown"
  | "pushed-back"
  | "deferred"
  | "prototype-flagged"
  | "out-of-scope"
  | "open-question"
  | "repo-established";

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
  introducedBy: "interviewer" | "user" | "repo";
  /** A repo decision's origin; null for every other decision. */
  repo: RepoDecisionOrigin | null;
}

/**
 * Where a repo decision came from. `statement` is what the project holds; once
 * the decision is reopened and answered in the interview, it is the repo
 * statement that answer replaced.
 */
export interface RepoDecisionOrigin {
  source: "recorded" | "inferred";
  citation: string;
  statement: string;
}

/** A proposed repo decision the user dropped: context, never enforced. */
export interface DroppedRepoDecision {
  key: string;
  title: string;
  statement: string;
  source: "recorded" | "inferred";
  citation: string;
  reason: string;
}

/**
 * What the session's current scout report says about its project, as every
 * turn reads it: the current state and the proposals the user dropped. Kept
 * decisions are not here; they are in the tree. A stale report is still sent,
 * marked stale with the commit it read.
 */
export interface ProjectContext {
  commitRead: string | null;
  stale: boolean;
  currentState: ScoutProjectResult["currentState"];
  droppedDecisions: DroppedRepoDecision[];
}

/**
 * Everything the interviewer needs about the session, whatever the request kind.
 * The port holds no state and reads no tables: this is its whole view of the world.
 */
export interface InterviewContext {
  /**
   * The session the request belongs to. The real adapter ignores it; the fake
   * uses it to keep one scripted queue per session.
   */
  sessionId: string;
  /** The loose idea the session started from. */
  idea: string;
  title: string | null;
  model: InterviewerModel;
  answeringMode: "whole-round" | "one-at-a-time";
  /** The conversation to resume, or null to start a new one. */
  conversationId: string | null;
  /**
   * An absolute folder the interviewer may read while grilling, or null for the
   * tool-less interview. Set, it is the only path the turn can reach, and it can
   * only be read: see {@link import("./claude-cli.js").DOCS_MODE_TOOLS}.
   */
  docsFolder: string | null;
  /** Every decision in the tree, in the order the app wants them read. */
  decisions: DecisionSnapshot[];
  /**
   * The session's scout report as context, or null when the session has none.
   * Built for every request kind by one function (`projectContextFor` in
   * `server/turn.ts`).
   */
  projectContext: ProjectContext | null;
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

export interface FindSupersededRequest extends RequestBase {
  kind: "find-superseded";
  /**
   * The loose ends to judge, by key: the ones the user could still answer
   * themselves — unknown, deferred, prototype flagged, or pushed back with no
   * response. A stale or unplaced decision is never one of them; those are the
   * interviewer's to resolve by another route.
   */
  looseEndKeys: string[];
}

export interface SynthesizeSpecRequest extends RequestBase {
  kind: "synthesize-spec";
  /** Loose ends the user moved out of scope, for the spec's Out of Scope section. */
  outOfScope: string[];
  /** Loose ends the user kept as named open questions, for Further Notes. */
  openQuestions: string[];
  /**
   * Repo decisions the interview reopened and answered differently, each with
   * the repo statement it replaced. The spec states each as a deliberate
   * change to the project.
   */
  reopenedRepoDecisions: ReopenedRepoDecision[];
}

/** A repo decision the interview changed: what the project held, and what it holds now. */
export interface ReopenedRepoDecision {
  key: string;
  title: string;
  source: "recorded" | "inferred";
  citation: string;
  /** The project's statement, which the interview replaced. */
  replacedStatement: string;
  /** The answer the interview settled on instead. */
  answer: string;
}

export interface BreakIntoTicketsRequest extends RequestBase {
  kind: "break-into-tickets";
  specMarkdown: string;
}

/**
 * One proposed repo decision of the session's current scout report, as the
 * readiness judge reads it: the scout's finding plus the user's disposition.
 */
export interface ScoutReportDecisionForReadiness {
  key: string;
  title: string;
  statement: string;
  source: "recorded" | "inferred";
  citation: string;
  reason: string;
  disposition: "undecided" | "kept" | "dropped";
}

/**
 * The session's current scout report, as the readiness judge reads it: the
 * scout's current-state findings and proposed decisions to draw repo evidence
 * from, the commit it read, and whether it is stale.
 */
export interface ScoutReportForReadiness {
  currentState: ScoutProjectResult["currentState"];
  proposedDecisions: ScoutReportDecisionForReadiness[];
  commitRead: string | null;
  stale: boolean;
}

/**
 * Judge whether the session's idea is ready to be grilled, before its first
 * round. Carries the idea and, when the session has a project and a report,
 * that report to ground the judgment's evidence. The tree is empty, and the
 * turn never joins the interview's conversation.
 */
export interface AssessReadinessRequest extends RequestBase {
  kind: "assess-readiness";
  /** The session's current scout report, or null without a project or report. */
  scoutReport: ScoutReportForReadiness | null;
}

export type { ProjectServerFacts };

/** A repo decision from the previous scout report, as the user left it. */
export interface PreviousRepoDecision {
  key: string;
  title: string;
  statement: string;
  source: "recorded" | "inferred";
  citation: string;
  /** Whether the user kept it, dropped it, or has not ruled on it yet. */
  disposition: "kept" | "dropped" | "proposed";
}

/**
 * Read a project for one idea, before the interview starts. The scout reads
 * the context's idea and title and nothing else from it: it always runs on
 * {@link SCOUT_MODEL} whatever the context's model, never resumes the context's
 * conversation, and reads {@link ScoutProjectRequest.projectRoot}, never the
 * context's docs folder.
 */
export interface ScoutProjectRequest extends RequestBase {
  kind: "scout-project";
  /** The absolute root of the project: the only folder the scout can read. */
  projectRoot: string;
  facts: ProjectServerFacts;
  /** The previous report's decisions on a re-run; empty on a first run. */
  previousDecisions: PreviousRepoDecision[];
}

/** The model every scout runs on. The session's model lock does not apply. */
export const SCOUT_MODEL: InterviewerModel = "sonnet";

/** One ticket of the handoff a handoff scout grounds. */
export interface HandoffScoutTicket {
  number: number;
  title: string;
  body: string;
  /** Numbers of the tickets that must land first. */
  blockedBy: number[];
}

/**
 * Ground every brief of a session's handoff in the project's code, in one
 * turn. Like {@link ScoutProjectRequest}, it always runs on
 * {@link SCOUT_MODEL} whatever the context's model, never resumes the
 * context's conversation, and reads {@link HandoffScoutRequest.projectRoot},
 * never the context's docs folder. From the context it reads only the idea
 * and title.
 */
export interface HandoffScoutRequest extends RequestBase {
  kind: "handoff-scout";
  /** The absolute root of the project: the only folder the scout can read. */
  projectRoot: string;
  facts: ProjectServerFacts;
  /** The session's spec, which defines the work with the tickets. */
  specMarkdown: string;
  /** Every ticket of the handoff, in number order. */
  tickets: HandoffScoutTicket[];
  /**
   * On a retry, the result the app refused last, as the scout returned it;
   * null on the first attempt. The scout never resumes a conversation, so a
   * retry starts fresh and this is how it sees the answer it is correcting.
   */
  previousResult: HandoffScoutResult | null;
}

/** A request that reads a whole project: sonnet, read-only, a conversation of its own. */
export type ProjectScoutRequest = ScoutProjectRequest | HandoffScoutRequest;

export type InterviewerRequest =
  | ProposeRoundRequest
  | ReviewStaleRequest
  | FindSupersededRequest
  | SynthesizeSpecRequest
  | BreakIntoTicketsRequest
  | AssessReadinessRequest
  | ScoutProjectRequest
  | HandoffScoutRequest;

/** Whether a request reads a whole project, as the project and handoff scouts do. */
export function isProjectScoutRequest(
  request: InterviewerRequest,
): request is ProjectScoutRequest {
  return request.kind === "scout-project" || request.kind === "handoff-scout";
}

/** A request narrowed to one kind, for generic code over every kind. */
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
 * How one model call ended. Every call ends in exactly one of these, and none
 * is ever folded into another:
 *
 * - `success`: the output passed the schema. Whether the app then accepts it
 *   is the app's call, not the port's.
 * - `schema-invalid`: the model answered, but not in the request's shape (not
 *   JSON, no conversation id, or failing the schema). The port rejects the
 *   method with `malformed-output`.
 * - `rate-limited`: the shared subscription pool is exhausted. Never an
 *   interviewer error. The port rejects the method with `rate-limited`.
 * - `resume-fallback`: resuming the conversation failed, so the port starts a
 *   fresh, primed one. Another call always follows within the same method call.
 * - `error`: anything else. The port rejects the method with this code.
 */
export type ModelCallOutcome =
  | { kind: "success"; rawOutput: string }
  | { kind: "schema-invalid"; rawOutput: string; reason: string }
  | { kind: "rate-limited"; reason: string }
  | { kind: "resume-fallback"; reason: string }
  | {
      kind: "error";
      code: Exclude<InterviewerErrorCode, "rate-limited" | "malformed-output">;
      reason: string;
    };

export type ModelCallOutcomeKind = ModelCallOutcome["kind"];

/**
 * Which conversation a call ran in: a new one, the session's resumed one, or
 * the fresh, primed one started after resuming failed.
 */
export type ModelCallConversation = "new" | "resumed" | "primed-after-resume";

/** A model call as it starts. */
export interface ModelCallStart {
  requestKind: RequestKind;
  /** 1-based position among the calls of one port method call. */
  call: number;
  conversation: ModelCallConversation;
  startedAt: Date;
}

/** A model call as it ends. */
export interface ModelCallEnd extends ModelCallStart {
  endedAt: Date;
  durationMs: number;
  outcome: ModelCallOutcome;
}

/**
 * Told when each model call starts and ends, in order, so a caller can record
 * attempts as they happen. One port method call makes one model call, or two
 * when a resume falls back to a fresh conversation. Every `callStarted` is
 * followed by exactly one `callEnded`, before the next call starts and before
 * the method settles. A returned promise is awaited; a throw or rejection
 * from the observer fails the method with that error.
 */
export interface ModelCallObserver {
  callStarted?(call: ModelCallStart): void | Promise<void>;
  callEnded?(call: ModelCallEnd): void | Promise<void>;
}

/**
 * The interviewer port. The only place the app talks to Claude.
 *
 * Every method either resolves with a schema-valid result or rejects with an
 * {@link import("./errors.js").InterviewerError}. The port guarantees nothing
 * beyond schema validity: the frontier rule, cycles and dangling dependency
 * links are the app's to enforce on the result.
 *
 * Each method takes an optional {@link ModelCallObserver}, which is told the
 * outcome of every model call the method makes. Without one, nothing changes.
 */
export interface Interviewer {
  proposeRound(
    request: ProposeRoundRequest,
    observer?: ModelCallObserver,
  ): Promise<InterviewerTurn<ProposeRoundResult>>;
  reviewStale(
    request: ReviewStaleRequest,
    observer?: ModelCallObserver,
  ): Promise<InterviewerTurn<ReviewStaleResult>>;
  findSuperseded(
    request: FindSupersededRequest,
    observer?: ModelCallObserver,
  ): Promise<InterviewerTurn<FindSupersededResult>>;
  synthesizeSpec(
    request: SynthesizeSpecRequest,
    observer?: ModelCallObserver,
  ): Promise<InterviewerTurn<SynthesizeSpecResult>>;
  breakIntoTickets(
    request: BreakIntoTicketsRequest,
    observer?: ModelCallObserver,
  ): Promise<InterviewerTurn<BreakIntoTicketsResult>>;
  assessReadiness(
    request: AssessReadinessRequest,
    observer?: ModelCallObserver,
  ): Promise<InterviewerTurn<AssessReadinessResult>>;
  scoutProject(
    request: ScoutProjectRequest,
    observer?: ModelCallObserver,
  ): Promise<InterviewerTurn<ScoutProjectResult>>;
  scoutHandoff(
    request: HandoffScoutRequest,
    observer?: ModelCallObserver,
  ): Promise<InterviewerTurn<HandoffScoutResult>>;
}
