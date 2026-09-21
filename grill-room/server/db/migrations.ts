import type { MigrationEntry } from "@agent-native/core/db";

/** Bookkeeping table this app owns; never shared with framework migrations. */
export const MIGRATIONS_TABLE = "gr_migrations";

/**
 * The app's schema, as an ordered list of additive migrations.
 *
 * This list is the single description of the schema: the startup plugin applies
 * it to the local database and the test harness applies it to each test's
 * in-memory database. Append entries with a new `version` and a stable `name`;
 * never renumber, rename, or edit an entry that has shipped.
 *
 * Every table and index here carries the `gr_` prefix. The app shares one
 * database with the framework, which creates well over a hundred generically
 * named tables of its own — `sessions`, `settings`, `documents`, `resources`,
 * `tools`. An unprefixed `CREATE TABLE IF NOT EXISTS sessions` is a silent
 * no-op against Better Auth's legacy `sessions` table, and the next migration
 * then fails on a foreign key to a column that does not exist. The prefix is
 * the invariant that keeps the two schemas apart; `test/table-names.test.ts`
 * enforces it.
 *
 * Versions 1-24 were rewritten in place once, when that collision was found:
 * no database had ever applied them successfully, so there was nothing to
 * preserve. That was a one-time repair. From here the normal rule holds again —
 * a shipped entry is never edited, renamed, or renumbered; schema changes are
 * appended as new entries.
 *
 * One statement per entry: the test harness (test/db.ts) runs each entry's sql
 * through a single prepared-statement execute() and cannot split a
 * multi-statement blob the way the production migration runner does, so every
 * entry below carries exactly one DDL statement.
 */
export const appMigrations: MigrationEntry[] = [
  {
    version: 1,
    name: "global-settings-table",
    sql: `CREATE TABLE IF NOT EXISTS gr_global_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )`,
  },
  {
    version: 2,
    name: "sessions-table",
    sql: `CREATE TABLE IF NOT EXISTS gr_sessions (
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
    sql: `CREATE TABLE IF NOT EXISTS gr_decisions (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES gr_sessions(id) ON DELETE CASCADE,
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
    sql: `CREATE INDEX IF NOT EXISTS gr_idx_decisions_session ON gr_decisions(session_id)`,
  },
  {
    version: 5,
    name: "decision-history-table",
    sql: `CREATE TABLE IF NOT EXISTS gr_decision_history (
      id TEXT PRIMARY KEY,
      decision_id TEXT NOT NULL REFERENCES gr_decisions(id) ON DELETE CASCADE,
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
    sql: `CREATE INDEX IF NOT EXISTS gr_idx_decision_history_decision ON gr_decision_history(decision_id)`,
  },
  {
    version: 7,
    name: "rounds-table",
    sql: `CREATE TABLE IF NOT EXISTS gr_rounds (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES gr_sessions(id) ON DELETE CASCADE,
      submission_state TEXT NOT NULL DEFAULT 'open',
      created_at TEXT NOT NULL,
      submitted_at TEXT
    )`,
  },
  {
    version: 8,
    name: "rounds-session-index",
    sql: `CREATE INDEX IF NOT EXISTS gr_idx_rounds_session ON gr_rounds(session_id)`,
  },
  {
    version: 9,
    name: "round-decisions-table",
    sql: `CREATE TABLE IF NOT EXISTS gr_round_decisions (
      id TEXT PRIMARY KEY,
      round_id TEXT NOT NULL REFERENCES gr_rounds(id) ON DELETE CASCADE,
      decision_id TEXT NOT NULL REFERENCES gr_decisions(id) ON DELETE CASCADE,
      sort_order INTEGER NOT NULL DEFAULT 0
    )`,
  },
  {
    version: 10,
    name: "round-decisions-round-index",
    sql: `CREATE INDEX IF NOT EXISTS gr_idx_round_decisions_round ON gr_round_decisions(round_id)`,
  },
  {
    version: 11,
    name: "round-decisions-unique-index",
    sql: `CREATE UNIQUE INDEX IF NOT EXISTS gr_idx_round_decisions_unique ON gr_round_decisions(round_id, decision_id)`,
  },
  {
    version: 12,
    name: "specs-table",
    sql: `CREATE TABLE IF NOT EXISTS gr_specs (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL UNIQUE REFERENCES gr_sessions(id) ON DELETE CASCADE,
      markdown TEXT NOT NULL,
      current BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`,
  },
  {
    version: 13,
    name: "tickets-table",
    sql: `CREATE TABLE IF NOT EXISTS gr_tickets (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES gr_sessions(id) ON DELETE CASCADE,
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
    sql: `CREATE INDEX IF NOT EXISTS gr_idx_tickets_session ON gr_tickets(session_id)`,
  },
  {
    version: 15,
    name: "build-records-table",
    sql: `CREATE TABLE IF NOT EXISTS gr_build_records (
      id TEXT PRIMARY KEY,
      ticket_id TEXT NOT NULL UNIQUE REFERENCES gr_tickets(id) ON DELETE CASCADE,
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
    sql: `ALTER TABLE gr_decisions ADD COLUMN IF NOT EXISTS key TEXT`,
  },
  {
    version: 17,
    name: "decisions-session-key-unique-index",
    sql: `CREATE UNIQUE INDEX IF NOT EXISTS gr_idx_decisions_session_key ON gr_decisions(session_id, key)`,
  },
  {
    version: 18,
    name: "decisions-pending-ask-column",
    sql: `ALTER TABLE gr_decisions ADD COLUMN IF NOT EXISTS pending_ask BOOLEAN NOT NULL DEFAULT FALSE`,
  },
  {
    version: 19,
    name: "round-decisions-draft-answer-column",
    sql: `ALTER TABLE gr_round_decisions ADD COLUMN IF NOT EXISTS draft_answer TEXT`,
  },
  {
    version: 20,
    name: "round-decisions-draft-answer-kind-column",
    sql: `ALTER TABLE gr_round_decisions ADD COLUMN IF NOT EXISTS draft_answer_kind TEXT`,
  },
  {
    version: 21,
    name: "sessions-turn-status-column",
    sql: `ALTER TABLE gr_sessions ADD COLUMN IF NOT EXISTS turn_status TEXT NOT NULL DEFAULT 'idle'`,
  },
  {
    version: 22,
    name: "sessions-turn-error-code-column",
    sql: `ALTER TABLE gr_sessions ADD COLUMN IF NOT EXISTS turn_error_code TEXT`,
  },
  {
    version: 23,
    name: "sessions-turn-error-message-column",
    sql: `ALTER TABLE gr_sessions ADD COLUMN IF NOT EXISTS turn_error_message TEXT`,
  },
  {
    version: 24,
    name: "sessions-turn-started-at-column",
    sql: `ALTER TABLE gr_sessions ADD COLUMN IF NOT EXISTS turn_started_at TEXT`,
  },
];
