/**
 * The single definition of every enumeration the app's schema constrains a
 * column to.
 *
 * They live here rather than in `server/db/schema.ts` because client code needs
 * them and that module pulls in Drizzle and the framework's schema helpers,
 * none of which belongs in the browser bundle. `schema.ts` imports and
 * re-exports this file, so server code can keep importing them from either
 * place and a column's `enum` can never drift from the values the UI offers.
 */

/** Interviewer models a session can be run with. Default is `fable`. */
export const SESSION_MODELS = ["fable", "opus", "sonnet"] as const;
export type SessionModel = (typeof SESSION_MODELS)[number];

/** Whether a session presents a round as one card set or one question at a time. */
export const SESSION_ANSWERING_MODES = [
  "whole-round",
  "one-at-a-time",
] as const;
export type SessionAnsweringMode = (typeof SESSION_ANSWERING_MODES)[number];

/** Lifecycle of a session: interviewing, awaiting the user's done confirmation, or confirmed. */
export const SESSION_STATES = [
  "interviewing",
  "done-proposed",
  "confirmed",
] as const;
export type SessionState = (typeof SESSION_STATES)[number];

/**
 * Where a session's interviewer turn stands. A turn takes about a minute, so
 * this is stored rather than held in memory: a client that reloads mid-turn
 * reads `working`, and a `failed` turn can be retried without losing why.
 */
export const SESSION_TURN_STATUSES = ["idle", "working", "failed"] as const;
export type SessionTurnStatus = (typeof SESSION_TURN_STATUSES)[number];

/**
 * How a decision's current answer was arrived at. `null` means no answer yet.
 * `repo-established` is a repo decision the user kept from the scout report:
 * the project had already made it, so its statement is its answer rather than
 * one chosen in the interview.
 */
export const DECISION_ANSWER_KINDS = [
  "accepted-recommendation",
  "own-answer",
  "unknown",
  "pushed-back",
  "deferred",
  "prototype-flagged",
  "dispositioned",
  "repo-established",
] as const;
export type DecisionAnswerKind = (typeof DECISION_ANSWER_KINDS)[number];

/** Where a "dispositioned" decision was resolved to. */
export const DECISION_DISPOSITION_TARGETS = [
  "out-of-scope",
  "open-question",
] as const;
export type DecisionDispositionTarget =
  (typeof DECISION_DISPOSITION_TARGETS)[number];

/**
 * Who put a decision into the tree. `repo` is a decision the project had
 * already made, kept by the user from the session's scout report.
 */
export const DECISION_INTRODUCED_BY = ["interviewer", "user", "repo"] as const;
export type DecisionIntroducedBy = (typeof DECISION_INTRODUCED_BY)[number];

/** Where a repo decision was read: written down, or inferred from code or configuration. */
export const REPO_DECISION_SOURCES = ["recorded", "inferred"] as const;
export type RepoDecisionSource = (typeof REPO_DECISION_SOURCES)[number];

/** Whether a round has been submitted to the interviewer yet. */
export const ROUND_SUBMISSION_STATES = ["open", "submitted"] as const;
export type RoundSubmissionState = (typeof ROUND_SUBMISSION_STATES)[number];

/** Lifecycle of an exported ticket. */
export const TICKET_STATUSES = ["ready", "in-progress", "done"] as const;
export type TicketStatus = (typeof TICKET_STATUSES)[number];

/** How a registered project tracks its tickets. Default is `markdown`. */
export const PROJECT_TRACKER_KINDS = ["beads", "markdown"] as const;
export type ProjectTrackerKind = (typeof PROJECT_TRACKER_KINDS)[number];

/**
 * Whether a project's export folder is version-controlled in its repo. Seeded
 * from `git check-ignore` at registration and editable afterwards; the handoff
 * renders its tracked or ignored instructions from this flag.
 */
export const PROJECT_VISIBILITIES = ["tracked", "ignored"] as const;
export type ProjectVisibility = (typeof PROJECT_VISIBILITIES)[number];

/** The slug pattern a project gets when none is given: the plain session slug. */
export const DEFAULT_PROJECT_SLUG_PATTERN = "{slug}";

/**
 * How one model-call attempt within a turn's run resolved. `success` is what
 * a turn's winning attempt gets. `tree-rule-refusal` is the only kind that
 * counts against the rejection budget and retries automatically; the rest
 * stop the turn for a manual retry. `error` is an interviewer fault (a
 * missing CLI, a lost login, any other failed call), kept apart from
 * `rate-limit` so exhausting the shared subscription is never read as a
 * defect. An attempt with no kind is still running. Closed list, unlike a
 * turn's own kind: every turn kind produces attempts from this same fixed
 * vocabulary.
 */
export const ATTEMPT_KINDS = [
  "tree-rule-refusal",
  "schema-invalid",
  "resume-fallback",
  "rate-limit",
  "error",
  "success",
] as const;
export type AttemptKind = (typeof ATTEMPT_KINDS)[number];
