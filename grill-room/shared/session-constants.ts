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

/** How a decision's current answer was arrived at. `null` means no answer yet. */
export const DECISION_ANSWER_KINDS = [
  "accepted-recommendation",
  "own-answer",
  "unknown",
  "pushed-back",
  "deferred",
  "prototype-flagged",
  "dispositioned",
] as const;
export type DecisionAnswerKind = (typeof DECISION_ANSWER_KINDS)[number];

/** Where a "dispositioned" decision was resolved to. */
export const DECISION_DISPOSITION_TARGETS = [
  "out-of-scope",
  "open-question",
] as const;
export type DecisionDispositionTarget =
  (typeof DECISION_DISPOSITION_TARGETS)[number];

/** Who put a decision into the tree. */
export const DECISION_INTRODUCED_BY = ["interviewer", "user"] as const;
export type DecisionIntroducedBy = (typeof DECISION_INTRODUCED_BY)[number];

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
