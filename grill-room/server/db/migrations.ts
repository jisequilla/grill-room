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
 * An entry may hold several statements separated by semicolons. Both the
 * startup plugin and the test harness apply this list through the framework's
 * migration runner, which does the splitting, so what works in one works in
 * the other. The entries below happen to be one statement each.
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
  {
    version: 25,
    name: "decisions-withdrawn-at-column",
    sql: `ALTER TABLE gr_decisions ADD COLUMN IF NOT EXISTS withdrawn_at TEXT`,
  },
  {
    version: 26,
    name: "decisions-awaiting-placement-since-column",
    sql: `ALTER TABLE gr_decisions ADD COLUMN IF NOT EXISTS awaiting_placement_since TEXT`,
  },
  {
    version: 27,
    name: "decision-history-interviewer-reason-column",
    sql: `ALTER TABLE gr_decision_history ADD COLUMN IF NOT EXISTS interviewer_reason TEXT`,
  },
  {
    version: 28,
    name: "sessions-done-summary-column",
    sql: `ALTER TABLE gr_sessions ADD COLUMN IF NOT EXISTS done_summary TEXT`,
  },
  {
    version: 29,
    name: "specs-tickets-generated-at-column",
    sql: `ALTER TABLE gr_specs ADD COLUMN IF NOT EXISTS tickets_generated_at TEXT`,
  },
  {
    version: 30,
    name: "decisions-choice-rationales-column",
    sql: `ALTER TABLE gr_decisions ADD COLUMN IF NOT EXISTS choice_rationales_json TEXT NOT NULL DEFAULT '[]'`,
  },
  {
    version: 31,
    name: "decisions-recommended-choice-column",
    sql: `ALTER TABLE gr_decisions ADD COLUMN IF NOT EXISTS recommended_choice INTEGER`,
  },
  {
    version: 32,
    name: "decisions-superseded-by-id-column",
    sql: `ALTER TABLE gr_decisions ADD COLUMN IF NOT EXISTS superseded_by_id TEXT REFERENCES gr_decisions(id) ON DELETE SET NULL`,
  },
  {
    version: 33,
    name: "decisions-supersession-answer-column",
    sql: `ALTER TABLE gr_decisions ADD COLUMN IF NOT EXISTS supersession_answer TEXT`,
  },
  {
    version: 34,
    name: "decisions-supersession-reason-column",
    sql: `ALTER TABLE gr_decisions ADD COLUMN IF NOT EXISTS supersession_reason TEXT`,
  },
  {
    version: 35,
    name: "sessions-docs-folder-column",
    sql: `ALTER TABLE gr_sessions ADD COLUMN IF NOT EXISTS docs_folder TEXT`,
  },
  {
    version: 36,
    name: "sessions-batch-progress-column",
    sql: `ALTER TABLE gr_sessions ADD COLUMN IF NOT EXISTS batch_progress_json TEXT`,
  },
  {
    version: 37,
    name: "projects-table",
    sql: `CREATE TABLE IF NOT EXISTS gr_projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      root_path TEXT NOT NULL UNIQUE,
      verify_command TEXT NOT NULL,
      export_folder TEXT NOT NULL,
      slug_pattern TEXT NOT NULL DEFAULT '{slug}',
      tracker_kind TEXT NOT NULL DEFAULT 'markdown',
      build_record_logging BOOLEAN NOT NULL DEFAULT FALSE,
      visibility TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`,
  },
  {
    version: 38,
    name: "sessions-project-id-column",
    sql: `ALTER TABLE gr_sessions ADD COLUMN IF NOT EXISTS project_id TEXT REFERENCES gr_projects(id) ON DELETE SET NULL`,
  },
  {
    version: 39,
    name: "projects-tracker-commands-column",
    sql: `ALTER TABLE gr_projects ADD COLUMN IF NOT EXISTS tracker_commands_json TEXT`,
  },
  {
    version: 40,
    name: "projects-tracker-diagnostic-column",
    sql: `ALTER TABLE gr_projects ADD COLUMN IF NOT EXISTS tracker_diagnostic TEXT`,
  },
  {
    version: 41,
    name: "handoffs-table",
    sql: `CREATE TABLE IF NOT EXISTS gr_handoffs (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL UNIQUE REFERENCES gr_sessions(id) ON DELETE CASCADE,
      markdown TEXT NOT NULL,
      briefs_json TEXT NOT NULL DEFAULT '[]',
      fingerprint TEXT NOT NULL,
      revision INTEGER NOT NULL DEFAULT 1,
      generated_at TEXT NOT NULL,
      edited_at TEXT,
      exported_fingerprint TEXT,
      exported_revision INTEGER,
      exported_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`,
  },
  {
    version: 42,
    name: "sessions-readiness-column",
    sql: `ALTER TABLE gr_sessions ADD COLUMN IF NOT EXISTS readiness_json TEXT`,
  },
  {
    version: 43,
    name: "turns-table",
    sql: `CREATE TABLE IF NOT EXISTS gr_turns (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES gr_sessions(id) ON DELETE CASCADE,
      turn_kind TEXT NOT NULL,
      model TEXT NOT NULL,
      started_at TEXT NOT NULL,
      completed_at TEXT,
      total_elapsed_ms INTEGER,
      outcome TEXT
    )`,
  },
  {
    version: 44,
    name: "turns-session-index",
    sql: `CREATE INDEX IF NOT EXISTS gr_idx_turns_session ON gr_turns(session_id)`,
  },
  {
    version: 45,
    name: "turn-runs-table",
    sql: `CREATE TABLE IF NOT EXISTS gr_turn_runs (
      id TEXT PRIMARY KEY,
      turn_id TEXT NOT NULL REFERENCES gr_turns(id) ON DELETE CASCADE,
      run_number INTEGER NOT NULL,
      manual_retry BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TEXT NOT NULL
    )`,
  },
  {
    version: 46,
    name: "turn-runs-turn-index",
    sql: `CREATE INDEX IF NOT EXISTS gr_idx_turn_runs_turn ON gr_turn_runs(turn_id)`,
  },
  {
    version: 47,
    name: "turn-runs-unique-index",
    sql: `CREATE UNIQUE INDEX IF NOT EXISTS gr_idx_turn_runs_unique ON gr_turn_runs(turn_id, run_number)`,
  },
  {
    version: 48,
    name: "turn-attempts-table",
    sql: `CREATE TABLE IF NOT EXISTS gr_turn_attempts (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL REFERENCES gr_turn_runs(id) ON DELETE CASCADE,
      attempt_number INTEGER NOT NULL,
      started_at TEXT NOT NULL,
      duration_ms INTEGER,
      kind TEXT,
      reason TEXT,
      raw_output TEXT
    )`,
  },
  {
    version: 49,
    name: "turn-attempts-run-index",
    sql: `CREATE INDEX IF NOT EXISTS gr_idx_turn_attempts_run ON gr_turn_attempts(run_id)`,
  },
  {
    version: 50,
    name: "turn-attempts-unique-index",
    sql: `CREATE UNIQUE INDEX IF NOT EXISTS gr_idx_turn_attempts_unique ON gr_turn_attempts(run_id, attempt_number)`,
  },
  {
    version: 51,
    name: "sessions-readiness-turn-id-column",
    sql: `ALTER TABLE gr_sessions ADD COLUMN IF NOT EXISTS readiness_turn_id TEXT REFERENCES gr_turns(id) ON DELETE SET NULL`,
  },
  {
    version: 52,
    name: "sessions-stale-review-turn-id-column",
    sql: `ALTER TABLE gr_sessions ADD COLUMN IF NOT EXISTS stale_review_turn_id TEXT REFERENCES gr_turns(id) ON DELETE SET NULL`,
  },
  {
    version: 53,
    name: "sessions-supersession-turn-id-column",
    sql: `ALTER TABLE gr_sessions ADD COLUMN IF NOT EXISTS supersession_turn_id TEXT REFERENCES gr_turns(id) ON DELETE SET NULL`,
  },
  {
    version: 54,
    name: "rounds-turn-id-column",
    sql: `ALTER TABLE gr_rounds ADD COLUMN IF NOT EXISTS turn_id TEXT REFERENCES gr_turns(id) ON DELETE SET NULL`,
  },
  {
    version: 55,
    name: "specs-turn-id-column",
    sql: `ALTER TABLE gr_specs ADD COLUMN IF NOT EXISTS turn_id TEXT REFERENCES gr_turns(id) ON DELETE SET NULL`,
  },
  {
    version: 56,
    name: "specs-tickets-turn-id-column",
    sql: `ALTER TABLE gr_specs ADD COLUMN IF NOT EXISTS tickets_turn_id TEXT REFERENCES gr_turns(id) ON DELETE SET NULL`,
  },
  {
    version: 57,
    name: "scout-reports-table",
    sql: `CREATE TABLE IF NOT EXISTS gr_scout_reports (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES gr_sessions(id) ON DELETE CASCADE,
      project_id TEXT REFERENCES gr_projects(id) ON DELETE SET NULL,
      facts_json TEXT NOT NULL,
      result_json TEXT NOT NULL,
      commit_read TEXT,
      idea_read TEXT NOT NULL,
      model TEXT NOT NULL,
      ran_at TEXT NOT NULL,
      turn_id TEXT REFERENCES gr_turns(id) ON DELETE SET NULL,
      dispositions_json TEXT NOT NULL DEFAULT '{}'
    )`,
  },
  {
    version: 58,
    name: "scout-reports-session-index",
    sql: `CREATE INDEX IF NOT EXISTS gr_idx_scout_reports_session ON gr_scout_reports(session_id)`,
  },
  {
    version: 59,
    name: "decisions-repo-origin-columns",
    sql: `ALTER TABLE gr_decisions ADD COLUMN IF NOT EXISTS repo_source TEXT;
ALTER TABLE gr_decisions ADD COLUMN IF NOT EXISTS repo_citation TEXT;
ALTER TABLE gr_decisions ADD COLUMN IF NOT EXISTS repo_statement TEXT;
ALTER TABLE gr_decisions ADD COLUMN IF NOT EXISTS scout_report_id TEXT`,
  },
  {
    version: 60,
    name: "sessions-last-export-folder-column",
    sql: `ALTER TABLE gr_sessions ADD COLUMN IF NOT EXISTS last_export_folder TEXT`,
  },
  {
    version: 61,
    name: "projects-delivery-recipe-columns",
    sql: `ALTER TABLE gr_projects ADD COLUMN IF NOT EXISTS delivery_recipe TEXT NOT NULL DEFAULT 'pull-request';
ALTER TABLE gr_projects ADD COLUMN IF NOT EXISTS adversarial_review BOOLEAN NOT NULL DEFAULT TRUE`,
  },
  {
    version: 62,
    name: "brief-groundings-table",
    sql: `CREATE TABLE IF NOT EXISTS gr_brief_groundings (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES gr_sessions(id) ON DELETE CASCADE,
      result_json TEXT NOT NULL,
      commit_read TEXT,
      handoff_fingerprint TEXT NOT NULL,
      model TEXT NOT NULL,
      ran_at TEXT NOT NULL,
      turn_id TEXT REFERENCES gr_turns(id) ON DELETE SET NULL
    )`,
  },
  {
    version: 63,
    name: "brief-groundings-session-index",
    sql: `CREATE UNIQUE INDEX IF NOT EXISTS gr_idx_brief_groundings_session ON gr_brief_groundings(session_id)`,
  },
  {
    version: 64,
    name: "decisions-replacement-link-columns",
    sql: `ALTER TABLE gr_decisions ADD COLUMN IF NOT EXISTS replaced_by_id TEXT;
ALTER TABLE gr_decisions ADD COLUMN IF NOT EXISTS replaced_reason TEXT;
ALTER TABLE gr_decisions ADD COLUMN IF NOT EXISTS settled_by_id TEXT`,
  },
  {
    version: 65,
    name: "projects-rename-export-folder",
    sql: `ALTER TABLE gr_projects RENAME COLUMN export_folder TO working_export_folder`,
  },
  {
    version: 66,
    name: "projects-durable-export-folder",
    sql: `ALTER TABLE gr_projects ADD COLUMN IF NOT EXISTS durable_export_folder TEXT NOT NULL DEFAULT 'docs/specs';
ALTER TABLE gr_projects ADD COLUMN IF NOT EXISTS visibility_recheck BOOLEAN NOT NULL DEFAULT false;
UPDATE gr_projects SET durable_export_folder = working_export_folder, working_export_folder = '.grill-room', visibility_recheck = true WHERE working_export_folder = 'docs' OR substr(working_export_folder, 1, 5) = 'docs/'`,
  },
];
