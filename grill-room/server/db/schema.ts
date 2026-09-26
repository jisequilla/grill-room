import {
  boolean,
  index,
  integer,
  table,
  text,
  uniqueIndex,
} from "@agent-native/core/db/schema";

import {
  ATTEMPT_KINDS,
  DEFAULT_DURABLE_EXPORT_FOLDER,
  DEFAULT_PROJECT_SLUG_PATTERN,
  DECISION_ANSWER_KINDS,
  DECISION_DISPOSITION_TARGETS,
  DECISION_INTRODUCED_BY,
  DELIVERY_RECIPES,
  PROJECT_TRACKER_KINDS,
  PROJECT_VISIBILITIES,
  REPO_DECISION_SOURCES,
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
  ATTEMPT_KINDS,
  type AttemptKind,
  DECISION_ANSWER_KINDS,
  type DecisionAnswerKind,
  DECISION_DISPOSITION_TARGETS,
  type DecisionDispositionTarget,
  DECISION_INTRODUCED_BY,
  type DecisionIntroducedBy,
  DEFAULT_PROJECT_SLUG_PATTERN,
  DELIVERY_RECIPES,
  type DeliveryRecipe,
  PROJECT_TRACKER_KINDS,
  type ProjectTrackerKind,
  PROJECT_VISIBILITIES,
  type ProjectVisibility,
  REPO_DECISION_SOURCES,
  type RepoDecisionSource,
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

/**
 * A repository sessions export into, registered once. Created and edited only
 * through `server/projects.ts`, which resolves `rootPath` to the git top-level
 * and validates every field; nothing else writes this table.
 */
export const projects = table("gr_projects", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  /** The absolute git top-level of the repository, as `git rev-parse --show-toplevel` reports it. */
  rootPath: text("root_path").notNull().unique(),
  verifyCommand: text("verify_command").notNull(),
  /**
   * Where the build's working files land (tickets, handoff, briefs), relative
   * to `rootPath`: deletable once the tickets merge.
   */
  workingExportFolder: text("working_export_folder").notNull(),
  /**
   * Where the durable files land (spec, decisions, intent), relative to
   * `rootPath`: kept after the build. Never equal to, inside, or containing
   * `workingExportFolder`.
   */
  durableExportFolder: text("durable_export_folder")
    .notNull()
    .default(DEFAULT_DURABLE_EXPORT_FOLDER),
  slugPattern: text("slug_pattern")
    .notNull()
    .default(DEFAULT_PROJECT_SLUG_PATTERN),
  trackerKind: text("tracker_kind", { enum: PROJECT_TRACKER_KINDS })
    .notNull()
    .default("markdown"),
  buildRecordLogging: boolean("build_record_logging").notNull().default(false),
  visibility: text("visibility", { enum: PROJECT_VISIBILITIES }).notNull(),
  /**
   * Set by a migration that moved `workingExportFolder`, so `visibility`
   * describes a folder the export no longer writes to. The registry re-seeds
   * the flag's row the next time it reads it, then clears it. Internal: never
   * part of `Project` or any action's result.
   */
  visibilityRecheck: boolean("visibility_recheck").notNull().default(false),
  /**
   * How a ticket built for this project reaches its main branch. Guessed
   * from the repository's remotes at registration unless given explicitly;
   * editable afterwards. See `DELIVERY_RECIPES`.
   */
  deliveryRecipe: text("delivery_recipe", { enum: DELIVERY_RECIPES })
    .notNull()
    .default("pull-request"),
  /** Whether a second, fresh-context reviewer checks each ticket before it merges. */
  adversarialReview: boolean("adversarial_review").notNull().default(true),
  /**
   * The declared tracker's `commands` map, as JSON text, or null when no
   * tracker was found. Set at registration and by `refresh-project-tracker`
   * only; ordinary edits never touch it. See `server/tracker.ts`.
   */
  trackerCommandsJson: text("tracker_commands_json"),
  /**
   * The diagnostic naming the missing or invalid key when the repo's tracker
   * block is present but incomplete, or null when there is no tracker or a
   * valid one. Set at registration and by `refresh-project-tracker` only.
   */
  trackerDiagnostic: text("tracker_diagnostic"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
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
  /** The registered project this session exports into, or null when none is chosen yet. */
  projectId: text("project_id").references(() => projects.id, {
    onDelete: "set null",
  }),
  /** A read-only folder the interviewer may read while grilling, or null for the tool-less interview. */
  docsFolder: text("docs_folder"),
  /**
   * The bundle folder the session's last successful export wrote to, relative
   * to its project's root, or null until the first export. A scout on this
   * session leaves out the `decisions.md` under it: the session's own record.
   */
  lastExportFolder: text("last_export_folder"),
  /**
   * The batch of reopens running on this session right now, as JSON: how many
   * items it holds, how many are done, which one it is on, and the outcome of
   * each one finished. A batch is many interviewer turns long, so its progress
   * is stored rather than held in the request: a reload mid-batch reads it, and
   * a second batch is refused while it is set. Null whenever no batch is
   * running. See {@link import("../reopen-batch.js").BatchProgress}.
   */
  batchProgressJson: text("batch_progress_json"),
  /**
   * The last readiness judgment of the session's idea, as JSON: the idea text
   * it judged, the judge's result, and when. Null until judged, and cleared
   * whenever the idea is edited; a result whose judged idea differs from the
   * current one reads as absent. See {@link import("../readiness.js").StoredReadiness}.
   */
  readinessJson: text("readiness_json"),
  /**
   * The turn that produced the current readiness judgment, or null when none
   * is linked. Not typed as a Drizzle reference — `gr_turns` itself
   * references `gr_sessions`, and a reference back here would make the two
   * tables' Drizzle types depend on each other. The `REFERENCES` constraint
   * still exists at the database level; see `server/db/migrations.ts`.
   */
  readinessTurnId: text("readiness_turn_id"),
  /** The turn of the most recent stale review, or null when none is linked. See `readinessTurnId`. */
  staleReviewTurnId: text("stale_review_turn_id"),
  /** The turn of the most recent supersession check, or null when none is linked. See `readinessTurnId`. */
  supersessionTurnId: text("supersession_turn_id"),
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
     * end, or, on a settled decision, the later one it believes replaced it. A
     * *proposal*, not an answer: the decision stays exactly as it was until the
     * user accepts, and accepting, answering, dispositioning, or reopening the
     * superseding decision clears all three columns.
     */
    supersededById: text("superseded_by_id"),
    /**
     * The answer the supersession proposes recording, in this decision's own
     * terms. Null for a replacement, which changes no answer.
     */
    supersessionAnswer: text("supersession_answer"),
    /** Which settled decision answers it and why, kept as the history entry's reason. */
    supersessionReason: text("supersession_reason"),
    /**
     * The settled decision that replaced this one, once the user accepted the
     * replacement. The answer stays as it was; this is the lasting link that
     * marks it out of date. Cleared when this decision's own answer changes,
     * or when the replacing decision is reopened.
     */
    replacedById: text("replaced_by_id"),
    /** The interviewer's reason for the replacement, kept on acceptance. */
    replacedReason: text("replaced_reason"),
    /**
     * For a loose end settled by accepting a supersession, the decision whose
     * answer settled it. Kept when that decision is reopened: it records where
     * the answer came from. Cleared when this decision's own answer changes.
     */
    settledById: text("settled_by_id"),
    /**
     * A repo decision's origin, set when the user keeps it from the scout
     * report and never changed afterwards: whether the project wrote it down
     * or it was inferred, where it was read, and the statement the project
     * holds. Once the decision is reopened and answered in the interview,
     * `repoStatement` is the repo statement that answer replaced. All four are
     * null for a decision the interviewer or the user introduced.
     */
    repoSource: text("repo_source", { enum: REPO_DECISION_SOURCES }),
    repoCitation: text("repo_citation"),
    repoStatement: text("repo_statement"),
    /**
     * The scout report the decision was kept from. Not a reference: a re-scout
     * replaces the report row, and the decision's origin outlives it.
     */
    scoutReportId: text("scout_report_id"),
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
    /** The turn that proposed this round, or null for a round from before turn records existed. */
    turnId: text("turn_id").references(() => turns.id, {
      onDelete: "set null",
    }),
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
  /** The turn that synthesized this spec, or null for a spec from before turn records existed. */
  turnId: text("turn_id").references(() => turns.id, {
    onDelete: "set null",
  }),
  /** The turn that broke this spec into tickets, or null for tickets from before turn records existed. */
  ticketsTurnId: text("tickets_turn_id").references(() => turns.id, {
    onDelete: "set null",
  }),
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

/**
 * A session's handoff: HANDOFF.md and one delegation brief per ticket, rendered
 * by `server/handoff.ts` from the session, spec, tickets and project. One row
 * per session.
 *
 * `fingerprint` hashes every input the templates rendered from; the handoff is
 * stale when the same hash over today's inputs differs. `revision` counts every
 * generation and edit, and `exportedRevision` is the revision the last export
 * wrote, so "edited or regenerated since the last export" compares two
 * integers rather than two timestamps that may share a millisecond.
 */
export const handoffs = table("gr_handoffs", {
  id: text("id").primaryKey(),
  sessionId: text("session_id")
    .notNull()
    .unique()
    .references(() => sessions.id, { onDelete: "cascade" }),
  /** HANDOFF.md, with `{{BUNDLE}}` standing for the bundle path export fills in. */
  markdown: text("markdown").notNull(),
  /** JSON array of `{ ticketNumber, relativePath, markdown }`, one per ticket, in number order. */
  briefsJson: text("briefs_json").notNull().default("[]"),
  fingerprint: text("fingerprint").notNull(),
  revision: integer("revision").notNull().default(1),
  generatedAt: text("generated_at").notNull(),
  /** Set by an edit in the UI, cleared by regeneration. */
  editedAt: text("edited_at"),
  exportedFingerprint: text("exported_fingerprint"),
  exportedRevision: integer("exported_revision"),
  exportedAt: text("exported_at"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

/**
 * One model turn: a call to the interviewer that can retry itself several
 * times before the app accepts its result or gives up. See
 * `server/turn-records.ts` for how these are created, appended to and read.
 *
 * `turnKind` is open text, not a closed enum: the six request kinds that run
 * through `askUntilAccepted` today (`assess-readiness`, `propose-round`,
 * `review-stale`, `find-superseded`, `synthesize-spec`, `break-into-tickets`)
 * and any later kind both need no migration to get turn records.
 */
export const turns = table(
  "gr_turns",
  {
    id: text("id").primaryKey(),
    sessionId: text("session_id")
      .notNull()
      .references(() => sessions.id, { onDelete: "cascade" }),
    turnKind: text("turn_kind").notNull(),
    /** The interviewer model this turn ran on. */
    model: text("model").notNull(),
    startedAt: text("started_at").notNull(),
    /** Set once the turn stops, whether it succeeded or was refused. */
    completedAt: text("completed_at"),
    /** `completedAt` minus `startedAt`, in milliseconds. Null while the turn is running. */
    totalElapsedMs: integer("total_elapsed_ms"),
    /**
     * `"succeeded"`, or the failure code the turn stopped with — the same
     * vocabulary `gr_sessions.turn_error_code` already uses (an interviewer
     * error code, a `TurnRejected`'s code for an exhausted budget, or
     * `"failed"`). Null while the turn is running.
     */
    outcome: text("outcome"),
  },
  (turnsTable) => ({
    sessionIdx: index("gr_idx_turns_session").on(turnsTable.sessionId),
  }),
);

/**
 * One pass through the app's retry loop, belonging to a turn. The first run
 * starts with the turn; each manual retry adds another. The rejection budget
 * counter is per run, starting again at 1 each time.
 */
export const turnRuns = table(
  "gr_turn_runs",
  {
    id: text("id").primaryKey(),
    turnId: text("turn_id")
      .notNull()
      .references(() => turns.id, { onDelete: "cascade" }),
    /** 1-based order within the turn. */
    runNumber: integer("run_number").notNull(),
    /** True for every run after the first: one the user started with a manual retry. */
    manualRetry: boolean("manual_retry").notNull().default(false),
    createdAt: text("created_at").notNull(),
  },
  (turnRunsTable) => ({
    turnIdx: index("gr_idx_turn_runs_turn").on(turnRunsTable.turnId),
    uniqueRunNumber: uniqueIndex("gr_idx_turn_runs_unique").on(
      turnRunsTable.turnId,
      turnRunsTable.runNumber,
    ),
  }),
);

/** One model call within a run. */
export const turnAttempts = table(
  "gr_turn_attempts",
  {
    id: text("id").primaryKey(),
    runId: text("run_id")
      .notNull()
      .references(() => turnRuns.id, { onDelete: "cascade" }),
    /**
     * 1-based order within the run. Counts a resume fallback too, which does
     * not spend the rejection budget, so this can run ahead of the budget
     * counter rather than matching it.
     */
    attemptNumber: integer("attempt_number").notNull(),
    startedAt: text("started_at").notNull(),
    /** Set once the attempt's model call returns or fails. Null while running. */
    durationMs: integer("duration_ms"),
    /** Set once the attempt completes. See {@link AttemptKind}. */
    kind: text("kind", { enum: ATTEMPT_KINDS }),
    /** One-line reason for anything that is not a success. */
    reason: text("reason"),
    /** The model's raw output, where there is one. */
    rawOutput: text("raw_output"),
  },
  (turnAttemptsTable) => ({
    runIdx: index("gr_idx_turn_attempts_run").on(turnAttemptsTable.runId),
    uniqueAttemptNumber: uniqueIndex("gr_idx_turn_attempts_unique").on(
      turnAttemptsTable.runId,
      turnAttemptsTable.attemptNumber,
    ),
  }),
);

/**
 * One scout run's report on a session's project: what the server knew for
 * certain, what the scout found, and what it read to find it. A re-run replaces
 * the session's row; one report per session. Staleness is never stored: see
 * `server/scout-report.ts`.
 */
export const scoutReports = table(
  "gr_scout_reports",
  {
    id: text("id").primaryKey(),
    sessionId: text("session_id")
      .notNull()
      .references(() => sessions.id, { onDelete: "cascade" }),
    /** The project it read, or null once that project is unregistered. */
    projectId: text("project_id").references(() => projects.id, {
      onDelete: "set null",
    }),
    /** The `ProjectServerFacts` the server collected, as JSON. */
    factsJson: text("facts_json").notNull(),
    /** The accepted `ScoutProjectResult`, as JSON. */
    resultJson: text("result_json").notNull(),
    /** The HEAD commit read, or null for a repository with no commits yet. */
    commitRead: text("commit_read"),
    /** The session's idea as the scout read it. */
    ideaRead: text("idea_read").notNull(),
    /** The model the scout ran on. */
    model: text("model").notNull(),
    ranAt: text("ran_at").notNull(),
    /** The turn that produced it. */
    turnId: text("turn_id").references(() => turns.id, {
      onDelete: "set null",
    }),
    /** Keep or drop per proposed decision, by key, as JSON. Every key starts `undecided`. */
    dispositionsJson: text("dispositions_json").notNull().default("{}"),
  },
  (scoutReportsTable) => ({
    sessionIdx: index("gr_idx_scout_reports_session").on(
      scoutReportsTable.sessionId,
    ),
  }),
);

/**
 * A session's brief grounding: the handoff scout's accepted result, tied to
 * the HEAD commit it read and the handoff fingerprint it was made for. A
 * re-run replaces the session's row; one grounding per session. Staleness is
 * never stored: see `server/brief-grounding.ts`.
 */
export const briefGroundings = table(
  "gr_brief_groundings",
  {
    id: text("id").primaryKey(),
    sessionId: text("session_id")
      .notNull()
      .references(() => sessions.id, { onDelete: "cascade" }),
    /** The accepted `HandoffScoutResult`, as JSON. */
    resultJson: text("result_json").notNull(),
    /** The HEAD commit read, or null for a repository with no commits yet. */
    commitRead: text("commit_read"),
    /** The handoff fingerprint the grounding was made for. */
    handoffFingerprint: text("handoff_fingerprint").notNull(),
    /** The model the scout ran on. */
    model: text("model").notNull(),
    ranAt: text("ran_at").notNull(),
    /** The turn that produced it. */
    turnId: text("turn_id").references(() => turns.id, {
      onDelete: "set null",
    }),
  },
  (briefGroundingsTable) => ({
    sessionIdx: uniqueIndex("gr_idx_brief_groundings_session").on(
      briefGroundingsTable.sessionId,
    ),
  }),
);
