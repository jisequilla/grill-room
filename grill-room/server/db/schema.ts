import {
  boolean,
  index,
  integer,
  table,
  text,
  uniqueIndex,
} from "@agent-native/core/db/schema";

import {
  DECISION_ANSWER_KINDS,
  DECISION_DISPOSITION_TARGETS,
  DECISION_INTRODUCED_BY,
  ROUND_SUBMISSION_STATES,
  SESSION_ANSWERING_MODES,
  SESSION_MODELS,
  SESSION_STATES,
  SESSION_TURN_STATUSES,
  TICKET_STATUSES,
} from "../../shared/session-constants.js";

/**
 * The column enumerations live in `shared/`, which the browser bundle can
 * import without dragging Drizzle in with them. They are re-exported here so
 * server code can reach them from the schema it is already importing.
 */
export {
  DECISION_ANSWER_KINDS,
  type DecisionAnswerKind,
  DECISION_DISPOSITION_TARGETS,
  type DecisionDispositionTarget,
  DECISION_INTRODUCED_BY,
  type DecisionIntroducedBy,
  ROUND_SUBMISSION_STATES,
  type RoundSubmissionState,
  SESSION_ANSWERING_MODES,
  type SessionAnsweringMode,
  SESSION_MODELS,
  type SessionModel,
  SESSION_STATES,
  type SessionState,
  SESSION_TURN_STATUSES,
  type SessionTurnStatus,
  TICKET_STATUSES,
  type TicketStatus,
} from "../../shared/session-constants.js";

/** App-wide preferences that are not tied to a single session. */
export const globalSettings = table("gr_global_settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
});

/** One grilling interview. The root of a session's decision tree, rounds, spec, and tickets. */
export const sessions = table("gr_sessions", {
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
  /** The done proposal's summary of every settled decision. Set with `state: "done-proposed"`, cleared whenever the session returns to interviewing. */
  doneSummary: text("done_summary"),
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
  "gr_decisions",
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
    /** JSON array of strings: the labels of the choices the interviewer offered, if any. */
    offeredChoicesJson: text("offered_choices_json").notNull().default("[]"),
    /**
     * JSON array of strings, parallel to `offeredChoicesJson`: the case for each
     * choice. Rows written before choices carried a rationale hold `[]`, which
     * is why the two arrays are read as a zip rather than required to match.
     */
    choiceRationalesJson: text("choice_rationales_json").notNull().default("[]"),
    recommendedAnswer: text("recommended_answer"),
    /**
     * Index into the choices of the one the recommendation picks. Null when the
     * question is open-ended, when the recommendation is none of the choices,
     * or when the row predates the interviewer being asked for it.
     */
    recommendedChoice: integer("recommended_choice"),
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
     * Set when a push back's response withdraws, replaces, or restructures this
     * decision. A withdrawn decision leaves the tree: excluded from derivation,
     * rounds and the frontier, and a dependency link pointing at it counts as
     * satisfied.
     */
    withdrawnAt: text("withdrawn_at"),
    /**
     * Set when the user adds this decision themselves, cleared once the
     * interviewer places it in the tree with its dependencies. Awaiting
     * placement, it is excluded from rounds and the frontier.
     */
    awaitingPlacementSince: text("awaiting_placement_since"),
    /**
     * True while the interviewer has asked for this decision but no round has
     * opened on it yet. One-at-a-time mode drains these one round at a time.
     */
    pendingAsk: boolean("pending_ask").notNull().default(false),
    /**
     * The settled decision the interviewer believes already answers this loose
     * end. A *proposal*, not an answer: the decision stays exactly as open as it
     * was until the user accepts, and accepting, answering, dispositioning, or
     * reopening the superseding decision clears all three columns.
     */
    supersededById: text("superseded_by_id"),
    /** The answer the supersession proposes recording, in this decision's own terms. */
    supersessionAnswer: text("supersession_answer"),
    /** Which settled decision answers it and why, kept as the history entry's reason. */
    supersessionReason: text("supersession_reason"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (decisionsTable) => ({
    sessionIdx: index("gr_idx_decisions_session").on(decisionsTable.sessionId),
    uniqueSessionKey: uniqueIndex("gr_idx_decisions_session_key").on(
      decisionsTable.sessionId,
      decisionsTable.key,
    ),
  }),
);

/** A previous answer of a decision, kept when it is reopened, re-asked, or reconfirmed. */
export const decisionHistory = table(
  "gr_decision_history",
  {
    id: text("id").primaryKey(),
    decisionId: text("decision_id")
      .notNull()
      .references(() => decisions.id, { onDelete: "cascade" }),
    questionTitle: text("question_title").notNull(),
    questionBody: text("question_body").notNull().default(""),
    answer: text("answer"),
    answerKind: text("answer_kind", { enum: DECISION_ANSWER_KINDS }),
    /**
     * What the interviewer said about superseding this answer: why a stale
     * decision was reconfirmed or re-asked, why a pushed-back one was
     * withdrawn, replaced, or restructured. Null when the entry was the user's
     * own doing, which is every reopen and every deferral.
     */
    interviewerReason: text("interviewer_reason"),
    recordedAt: text("recorded_at").notNull(),
  },
  (decisionHistoryTable) => ({
    decisionIdx: index("gr_idx_decision_history_decision").on(
      decisionHistoryTable.decisionId,
    ),
  }),
);

/** An ordered set of decisions asked together. One-at-a-time mode holds a single decision. */
export const rounds = table(
  "gr_rounds",
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
    sessionIdx: index("gr_idx_rounds_session").on(roundsTable.sessionId),
  }),
);

/** Join table ordering the decisions asked within one round. */
export const roundDecisions = table(
  "gr_round_decisions",
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
     * The answer as given in this round: a draft while the round is open, and
     * the record of what was submitted once it closes. Held here rather than on
     * the decision so it is scoped to the round that asked the question, and
     * survives a reload.
     */
    draftAnswer: text("draft_answer"),
    draftAnswerKind: text("draft_answer_kind", { enum: DECISION_ANSWER_KINDS }),
  },
  (roundDecisionsTable) => ({
    roundIdx: index("gr_idx_round_decisions_round").on(
      roundDecisionsTable.roundId,
    ),
    uniqueRoundDecision: uniqueIndex("gr_idx_round_decisions_unique").on(
      roundDecisionsTable.roundId,
      roundDecisionsTable.decisionId,
    ),
  }),
);

/** The synthesized markdown spec for a session. One row per session. */
export const specs = table("gr_specs", {
  id: text("id").primaryKey(),
  sessionId: text("session_id")
    .notNull()
    .unique()
    .references(() => sessions.id, { onDelete: "cascade" }),
  markdown: text("markdown").notNull(),
  /** False once a decision the spec was built from is reopened or re-settled. */
  current: boolean("current").notNull().default(true),
  /**
   * When tickets were last generated from this spec. Tickets are current iff
   * this spec is `current` and this is not earlier than `updatedAt` — set here
   * rather than on the tickets themselves, so regenerating the spec alone is
   * enough to mark them out of date.
   */
  ticketsGeneratedAt: text("tickets_generated_at"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

/** One implementation ticket broken out of a session's confirmed spec. */
export const tickets = table(
  "gr_tickets",
  {
    id: text("id").primaryKey(),
    sessionId: text("session_id")
      .notNull()
      .references(() => sessions.id, { onDelete: "cascade" }),
    number: integer("number").notNull(),
    slug: text("slug").notNull(),
    title: text("title").notNull(),
    body: text("body").notNull(),
    status: text("status", { enum: TICKET_STATUSES })
      .notNull()
      .default("ready"),
    /** JSON array of ticket ids that block this one. */
    blockedByJson: text("blocked_by_json").notNull().default("[]"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (ticketsTable) => ({
    sessionIdx: index("gr_idx_tickets_session").on(ticketsTable.sessionId),
  }),
);

/** The build outcome of one ticket, logged by the orchestrating agent. */
export const buildRecords = table("gr_build_records", {
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
