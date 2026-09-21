import {
  boolean,
  index,
  integer,
  table,
  text,
  uniqueIndex,
} from "@agent-native/core/db/schema";

/** Interviewer models a session can be run with. Default is `fable`. */
export const SESSION_MODELS = ["fable", "opus", "sonnet"] as const;
export type SessionModel = (typeof SESSION_MODELS)[number];

/** Whether a session presents a round as one card set or one question at a time. */
export const SESSION_ANSWERING_MODES = ["whole-round", "one-at-a-time"] as const;
export type SessionAnsweringMode = (typeof SESSION_ANSWERING_MODES)[number];

/** Lifecycle of a session: interviewing, awaiting the user's done confirmation, or confirmed. */
export const SESSION_STATES = [
  "interviewing",
  "done-proposed",
  "confirmed",
] as const;
export type SessionState = (typeof SESSION_STATES)[number];

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

/**
 * Where a session's interviewer turn stands. A turn takes about a minute, so
 * this is stored rather than held in memory: a client that reloads mid-turn
 * reads `working`, and a `failed` turn can be retried without losing why.
 */
export const SESSION_TURN_STATUSES = ["idle", "working", "failed"] as const;
export type SessionTurnStatus = (typeof SESSION_TURN_STATUSES)[number];

/** Lifecycle of an exported ticket. */
export const TICKET_STATUSES = ["ready", "in-progress", "done"] as const;
export type TicketStatus = (typeof TICKET_STATUSES)[number];

/** App-wide preferences that are not tied to a single session. */
export const globalSettings = table("global_settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
});

/** One grilling interview. The root of a session's decision tree, rounds, spec, and tickets. */
export const sessions = table("sessions", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  idea: text("idea").notNull(),
  model: text("model", { enum: SESSION_MODELS }).notNull().default("fable"),
  answeringMode: text("answering_mode", { enum: SESSION_ANSWERING_MODES })
    .notNull()
    .default("whole-round"),
  state: text("state", { enum: SESSION_STATES })
    .notNull()
    .default("interviewing"),
  conversationId: text("conversation_id"),
  exportTargetFolder: text("export_target_folder"),
  /** Where the current interviewer turn stands. See {@link SESSION_TURN_STATUSES}. */
  turnStatus: text("turn_status", { enum: SESSION_TURN_STATUSES })
    .notNull()
    .default("idle"),
  /** The {@link import("../interviewer/errors.js").InterviewerErrorCode} of a failed turn, or `invalid-proposal`. */
  turnErrorCode: text("turn_error_code"),
  turnErrorMessage: text("turn_error_message"),
  turnStartedAt: text("turn_started_at"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

/**
 * A node of a session's design tree. State (settled/frontier/blocked/stale) is
 * derived from `answerKind` and `dependsOnJson`, never stored: `settledAt` and
 * `reopenedAt` are the raw facts that derivation compares, not a cached state.
 */
export const decisions = table(
  "decisions",
  {
    id: text("id").primaryKey(),
    sessionId: text("session_id")
      .notNull()
      .references(() => sessions.id, { onDelete: "cascade" }),
    /**
     * The stable key the interviewer identifies this decision by, unique within
     * the session. The interviewer speaks keys; every table links by id.
     */
    key: text("key"),
    questionTitle: text("question_title").notNull(),
    questionBody: text("question_body").notNull().default(""),
    /** JSON array of strings: the choices the interviewer offered, if any. */
    offeredChoicesJson: text("offered_choices_json").notNull().default("[]"),
    recommendedAnswer: text("recommended_answer"),
    currentAnswer: text("current_answer"),
    answerKind: text("answer_kind", { enum: DECISION_ANSWER_KINDS }),
    dispositionTarget: text("disposition_target", {
      enum: DECISION_DISPOSITION_TARGETS,
    }),
    /** JSON array of decision ids this decision depends on. */
    dependsOnJson: text("depends_on_json").notNull().default("[]"),
    introducedBy: text("introduced_by", { enum: DECISION_INTRODUCED_BY })
      .notNull()
      .default("interviewer"),
    /** Set whenever this decision becomes settled; cleared when it is reopened. */
    settledAt: text("settled_at"),
    /** Set whenever this decision is reopened; compared against dependents' `settledAt`. */
    reopenedAt: text("reopened_at"),
    /**
     * True while the interviewer has asked for this decision but no round has
     * opened on it yet. One-at-a-time mode drains these one round at a time.
     */
    pendingAsk: boolean("pending_ask").notNull().default(false),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (decisionsTable) => ({
    sessionIdx: index("idx_decisions_session").on(decisionsTable.sessionId),
    uniqueSessionKey: uniqueIndex("idx_decisions_session_key").on(
      decisionsTable.sessionId,
      decisionsTable.key,
    ),
  }),
);

/** A previous answer of a decision, kept when it is reopened, re-asked, or reconfirmed. */
export const decisionHistory = table(
  "decision_history",
  {
    id: text("id").primaryKey(),
    decisionId: text("decision_id")
      .notNull()
      .references(() => decisions.id, { onDelete: "cascade" }),
    questionTitle: text("question_title").notNull(),
    questionBody: text("question_body").notNull().default(""),
    answer: text("answer"),
    answerKind: text("answer_kind", { enum: DECISION_ANSWER_KINDS }),
    recordedAt: text("recorded_at").notNull(),
  },
  (decisionHistoryTable) => ({
    decisionIdx: index("idx_decision_history_decision").on(
      decisionHistoryTable.decisionId,
    ),
  }),
);

/** An ordered set of decisions asked together. One-at-a-time mode holds a single decision. */
export const rounds = table(
  "rounds",
  {
    id: text("id").primaryKey(),
    sessionId: text("session_id")
      .notNull()
      .references(() => sessions.id, { onDelete: "cascade" }),
    submissionState: text("submission_state", {
      enum: ROUND_SUBMISSION_STATES,
    })
      .notNull()
      .default("open"),
    createdAt: text("created_at").notNull(),
    submittedAt: text("submitted_at"),
  },
  (roundsTable) => ({
    sessionIdx: index("idx_rounds_session").on(roundsTable.sessionId),
  }),
);

/** Join table ordering the decisions asked within one round. */
export const roundDecisions = table(
  "round_decisions",
  {
    id: text("id").primaryKey(),
    roundId: text("round_id")
      .notNull()
      .references(() => rounds.id, { onDelete: "cascade" }),
    decisionId: text("decision_id")
      .notNull()
      .references(() => decisions.id, { onDelete: "cascade" }),
    sortOrder: integer("sort_order").notNull().default(0),
    /**
     * What the user has typed or picked but not yet submitted. Held here rather
     * than on the decision so it is scoped to the round that asked it, and
     * survives a reload for as long as that round stays open.
     */
    draftAnswer: text("draft_answer"),
    draftAnswerKind: text("draft_answer_kind", { enum: DECISION_ANSWER_KINDS }),
  },
  (roundDecisionsTable) => ({
    roundIdx: index("idx_round_decisions_round").on(roundDecisionsTable.roundId),
    uniqueRoundDecision: uniqueIndex("idx_round_decisions_unique").on(
      roundDecisionsTable.roundId,
      roundDecisionsTable.decisionId,
    ),
  }),
);

/** The synthesized markdown spec for a session. One row per session. */
export const specs = table("specs", {
  id: text("id").primaryKey(),
  sessionId: text("session_id")
    .notNull()
    .unique()
    .references(() => sessions.id, { onDelete: "cascade" }),
  markdown: text("markdown").notNull(),
  /** False once a decision the spec was built from is reopened or re-settled. */
  current: boolean("current").notNull().default(true),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

/** One implementation ticket broken out of a session's confirmed spec. */
export const tickets = table(
  "tickets",
  {
    id: text("id").primaryKey(),
    sessionId: text("session_id")
      .notNull()
      .references(() => sessions.id, { onDelete: "cascade" }),
    number: integer("number").notNull(),
    slug: text("slug").notNull(),
    title: text("title").notNull(),
    body: text("body").notNull(),
    status: text("status", { enum: TICKET_STATUSES }).notNull().default("ready"),
    /** JSON array of ticket ids that block this one. */
    blockedByJson: text("blocked_by_json").notNull().default("[]"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (ticketsTable) => ({
    sessionIdx: index("idx_tickets_session").on(ticketsTable.sessionId),
  }),
);

/** The build outcome of one ticket, logged by the orchestrating agent. */
export const buildRecords = table("build_records", {
  id: text("id").primaryKey(),
  ticketId: text("ticket_id")
    .notNull()
    .unique()
    .references(() => tickets.id, { onDelete: "cascade" }),
  model: text("model"),
  firstAttemptPassed: boolean("first_attempt_passed"),
  escalated: boolean("escalated"),
  promptMissing: text("prompt_missing"),
  notes: text("notes"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});
