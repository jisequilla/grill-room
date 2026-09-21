import type { MigrationEntry } from "@agent-native/core/db";

/** Bookkeeping table this app owns; never shared with framework migrations. */
export const MIGRATIONS_TABLE = "grill_room_migrations";

/**
 * The app's schema, as an ordered list of additive migrations.
 *
 * This list is the single description of the schema: the startup plugin applies
 * it to the local database and the test harness applies it to each test's
 * in-memory database. Append entries with a new `version` and a stable `name`;
 * never renumber, rename, or edit an entry that has shipped.
 */
export const appMigrations: MigrationEntry[] = [
  {
    version: 1,
    name: "global-settings-table",
    sql: `CREATE TABLE IF NOT EXISTS global_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )`,
  },
  {
    version: 2,
    name: "sessions-table",
    sql: `CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      idea TEXT NOT NULL,
      model TEXT NOT NULL DEFAULT 'fable',
      answering_mode TEXT NOT NULL DEFAULT 'whole-round',
      state TEXT NOT NULL DEFAULT 'interviewing',
      conversation_id TEXT,
      export_target_folder TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`,
  },
  {
    version: 3,
    name: "decisions-table",
    // One statement per entry: the test harness (test/db.ts) runs each
    // entry's sql through a single prepared-statement execute() and cannot
    // split a multi-statement blob the way the production migration runner
    // does, so every entry below carries exactly one DDL statement.
    sql: `CREATE TABLE IF NOT EXISTS decisions (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      question_title TEXT NOT NULL,
      question_body TEXT NOT NULL DEFAULT '',
      offered_choices_json TEXT NOT NULL DEFAULT '[]',
      recommended_answer TEXT,
      current_answer TEXT,
      answer_kind TEXT,
      disposition_target TEXT,
      depends_on_json TEXT NOT NULL DEFAULT '[]',
      introduced_by TEXT NOT NULL DEFAULT 'interviewer',
      settled_at TEXT,
      reopened_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`,
  },
  {
    version: 4,
    name: "decisions-session-index",
    sql: `CREATE INDEX IF NOT EXISTS idx_decisions_session ON decisions(session_id)`,
  },
  {
    version: 5,
    name: "decision-history-table",
    sql: `CREATE TABLE IF NOT EXISTS decision_history (
      id TEXT PRIMARY KEY,
      decision_id TEXT NOT NULL REFERENCES decisions(id) ON DELETE CASCADE,
      question_title TEXT NOT NULL,
      question_body TEXT NOT NULL DEFAULT '',
      answer TEXT,
      answer_kind TEXT,
      recorded_at TEXT NOT NULL
    )`,
  },
  {
    version: 6,
    name: "decision-history-decision-index",
    sql: `CREATE INDEX IF NOT EXISTS idx_decision_history_decision ON decision_history(decision_id)`,
  },
  {
    version: 7,
    name: "rounds-table",
    sql: `CREATE TABLE IF NOT EXISTS rounds (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      submission_state TEXT NOT NULL DEFAULT 'open',
      created_at TEXT NOT NULL,
      submitted_at TEXT
    )`,
  },
  {
    version: 8,
    name: "rounds-session-index",
    sql: `CREATE INDEX IF NOT EXISTS idx_rounds_session ON rounds(session_id)`,
  },
  {
    version: 9,
    name: "round-decisions-table",
    sql: `CREATE TABLE IF NOT EXISTS round_decisions (
      id TEXT PRIMARY KEY,
      round_id TEXT NOT NULL REFERENCES rounds(id) ON DELETE CASCADE,
      decision_id TEXT NOT NULL REFERENCES decisions(id) ON DELETE CASCADE,
      sort_order INTEGER NOT NULL DEFAULT 0
    )`,
  },
  {
    version: 10,
    name: "round-decisions-round-index",
    sql: `CREATE INDEX IF NOT EXISTS idx_round_decisions_round ON round_decisions(round_id)`,
  },
  {
    version: 11,
    name: "round-decisions-unique-index",
    sql: `CREATE UNIQUE INDEX IF NOT EXISTS idx_round_decisions_unique ON round_decisions(round_id, decision_id)`,
  },
  {
    version: 12,
    name: "specs-table",
    sql: `CREATE TABLE IF NOT EXISTS specs (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL UNIQUE REFERENCES sessions(id) ON DELETE CASCADE,
      markdown TEXT NOT NULL,
      current BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`,
  },
  {
    version: 13,
    name: "tickets-table",
    sql: `CREATE TABLE IF NOT EXISTS tickets (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      number INTEGER NOT NULL,
      slug TEXT NOT NULL,
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'ready',
      blocked_by_json TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`,
  },
  {
    version: 14,
    name: "tickets-session-index",
    sql: `CREATE INDEX IF NOT EXISTS idx_tickets_session ON tickets(session_id)`,
  },
  {
    version: 15,
    name: "build-records-table",
    sql: `CREATE TABLE IF NOT EXISTS build_records (
      id TEXT PRIMARY KEY,
      ticket_id TEXT NOT NULL UNIQUE REFERENCES tickets(id) ON DELETE CASCADE,
      model TEXT,
      first_attempt_passed BOOLEAN,
      escalated BOOLEAN,
      prompt_missing TEXT,
      notes TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`,
  },
  {
    version: 16,
    name: "decisions-key-column",
    sql: `ALTER TABLE decisions ADD COLUMN IF NOT EXISTS key TEXT`,
  },
  {
    version: 17,
    name: "decisions-session-key-unique-index",
    sql: `CREATE UNIQUE INDEX IF NOT EXISTS idx_decisions_session_key ON decisions(session_id, key)`,
  },
  {
    version: 18,
    name: "decisions-pending-ask-column",
    sql: `ALTER TABLE decisions ADD COLUMN IF NOT EXISTS pending_ask BOOLEAN NOT NULL DEFAULT FALSE`,
  },
  {
    version: 19,
    name: "round-decisions-draft-answer-column",
    sql: `ALTER TABLE round_decisions ADD COLUMN IF NOT EXISTS draft_answer TEXT`,
  },
  {
    version: 20,
    name: "round-decisions-draft-answer-kind-column",
    sql: `ALTER TABLE round_decisions ADD COLUMN IF NOT EXISTS draft_answer_kind TEXT`,
  },
  {
    version: 21,
    name: "sessions-turn-status-column",
    sql: `ALTER TABLE sessions ADD COLUMN IF NOT EXISTS turn_status TEXT NOT NULL DEFAULT 'idle'`,
  },
  {
    version: 22,
    name: "sessions-turn-error-code-column",
    sql: `ALTER TABLE sessions ADD COLUMN IF NOT EXISTS turn_error_code TEXT`,
  },
  {
    version: 23,
    name: "sessions-turn-error-message-column",
    sql: `ALTER TABLE sessions ADD COLUMN IF NOT EXISTS turn_error_message TEXT`,
  },
  {
    version: 24,
    name: "sessions-turn-started-at-column",
    sql: `ALTER TABLE sessions ADD COLUMN IF NOT EXISTS turn_started_at TEXT`,
  },
];
