/**
 * Migration-by-migration checks that don't fit `test/table-names.test.ts`
 * (which asserts on the whole schema, not on what one migration does to data
 * already in a table).
 */
import { randomUUID } from "node:crypto";

import { getDbExec, getRuntimeDatabaseUrl } from "@agent-native/core/db";
import { beforeEach, describe, expect, it } from "vitest";

import { applyMigrations } from "../../test/db.js";
import { IN_MEMORY_DATABASE_URL } from "../../test/setup.js";
import { appMigrations, MIGRATIONS_TABLE } from "./migrations.js";

async function dropSchema(): Promise<void> {
  if (getRuntimeDatabaseUrl() !== IN_MEMORY_DATABASE_URL) {
    throw new Error(
      "Refusing to drop a database that is not the in-memory test instance",
    );
  }
  const exec = getDbExec();
  await exec.execute("DROP SCHEMA IF EXISTS public CASCADE");
  await exec.execute("CREATE SCHEMA public");
}

describe("projects-rename-export-folder migration", () => {
  beforeEach(dropSchema);

  it("renames gr_projects.export_folder to working_export_folder, keeping the data", async () => {
    const before = appMigrations.filter((migration) => migration.version < 65);
    await applyMigrations(before, MIGRATIONS_TABLE);

    const id = randomUUID();
    const now = new Date().toISOString();
    await getDbExec().execute({
      sql: `INSERT INTO gr_projects (id, name, root_path, verify_command, export_folder, visibility, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [id, "Grill Room", "/repos/grill-room", "pnpm test", ".scratch", "tracked", now, now],
    });

    await applyMigrations(appMigrations, MIGRATIONS_TABLE);

    const { rows } = await getDbExec().execute({
      sql: `SELECT working_export_folder FROM gr_projects WHERE id = ?`,
      args: [id],
    });
    expect(rows).toEqual([{ working_export_folder: ".scratch" }]);
  });
});

describe("projects-durable-export-folder migration", () => {
  beforeEach(dropSchema);

  // `recheck`: a moved row's visibility was measured for its old folder, so
  // it is flagged to be re-seeded on next read; an unmoved row is not.
  const cases: Array<{ stored: string; working: string; durable: string; recheck: boolean }> = [
    { stored: "docs/specs", working: ".grill-room", durable: "docs/specs", recheck: true },
    { stored: "docs", working: ".grill-room", durable: "docs", recheck: true },
    { stored: ".grill-room", working: ".grill-room", durable: "docs/specs", recheck: false },
    { stored: ".scratch", working: ".scratch", durable: "docs/specs", recheck: false },
    { stored: "docs-site", working: "docs-site", durable: "docs/specs", recheck: false },
    { stored: ".docs", working: ".docs", durable: "docs/specs", recheck: false },
  ];

  it("maps each stored working folder to a working and a durable root by where it points", async () => {
    const before = appMigrations.filter((migration) => migration.version < 66);
    await applyMigrations(before, MIGRATIONS_TABLE);

    const now = new Date().toISOString();
    const ids = new Map<string, string>();
    for (const { stored } of cases) {
      const id = randomUUID();
      ids.set(stored, id);
      await getDbExec().execute({
        sql: `INSERT INTO gr_projects (id, name, root_path, verify_command, working_export_folder, visibility, created_at, updated_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [id, stored, `/repos/${stored}`, "pnpm test", stored, "tracked", now, now],
      });
    }

    await applyMigrations(appMigrations, MIGRATIONS_TABLE);

    for (const { stored, working, durable, recheck } of cases) {
      const { rows } = await getDbExec().execute({
        sql: `SELECT working_export_folder, durable_export_folder, visibility_recheck FROM gr_projects WHERE id = ?`,
        args: [ids.get(stored) as string],
      });
      expect({ stored, row: rows[0] }).toEqual({
        stored,
        row: {
          working_export_folder: working,
          durable_export_folder: durable,
          visibility_recheck: recheck,
        },
      });
    }
  });
});

describe("decisions-deferral-reason-column migration", () => {
  beforeEach(dropSchema);

  it("adds a nullable deferral_reason to a database at v66, leaving existing decisions without one", async () => {
    const before = appMigrations.filter((migration) => migration.version <= 66);
    await applyMigrations(before, MIGRATIONS_TABLE);

    const now = new Date().toISOString();
    const sessionId = randomUUID();
    const decisionId = randomUUID();
    await getDbExec().execute({
      sql: `INSERT INTO gr_sessions (id, title, idea, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`,
      args: [sessionId, "Grill Room", "An idea.", now, now],
    });
    await getDbExec().execute({
      sql: `INSERT INTO gr_decisions (id, session_id, question_title, question_body, offered_choices_json, depends_on_json, introduced_by, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [decisionId, sessionId, "How long is a payout held?", "", "[]", "[]", "interviewer", now, now],
    });

    await applyMigrations(appMigrations, MIGRATIONS_TABLE);

    const { rows } = await getDbExec().execute({
      sql: `SELECT deferral_reason FROM gr_decisions WHERE id = ?`,
      args: [decisionId],
    });
    expect(rows).toEqual([{ deferral_reason: null }]);

    await getDbExec().execute({
      sql: `UPDATE gr_decisions SET deferral_reason = ? WHERE id = ?`,
      args: ["It waits on dispute handling.", decisionId],
    });
    const updated = await getDbExec().execute({
      sql: `SELECT deferral_reason FROM gr_decisions WHERE id = ?`,
      args: [decisionId],
    });
    expect(updated.rows).toEqual([{ deferral_reason: "It waits on dispute handling." }]);
  });
});

describe("decisions-restatement-columns migration", () => {
  beforeEach(dropSchema);

  it("adds nullable restatement columns to decisions and operator_notes to history, on a database at v67", async () => {
    const before = appMigrations.filter((migration) => migration.version <= 67);
    await applyMigrations(before, MIGRATIONS_TABLE);

    const now = new Date().toISOString();
    const sessionId = randomUUID();
    const decisionId = randomUUID();
    const historyId = randomUUID();
    await getDbExec().execute({
      sql: `INSERT INTO gr_sessions (id, title, idea, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`,
      args: [sessionId, "Grill Room", "An idea.", now, now],
    });
    await getDbExec().execute({
      sql: `INSERT INTO gr_decisions (id, session_id, question_title, question_body, offered_choices_json, depends_on_json, introduced_by, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [decisionId, sessionId, "Which payment provider?", "", "[]", "[]", "interviewer", now, now],
    });
    await getDbExec().execute({
      sql: `INSERT INTO gr_decision_history (id, decision_id, question_title, answer, answer_kind, recorded_at)
            VALUES (?, ?, ?, ?, ?, ?)`,
      args: [historyId, decisionId, "Which payment provider?", "Stripe.", "own-answer", now],
    });

    await applyMigrations(appMigrations, MIGRATIONS_TABLE);

    const decision = await getDbExec().execute({
      sql: `SELECT restatement_text, restatement_notes, restatement_reason FROM gr_decisions WHERE id = ?`,
      args: [decisionId],
    });
    expect(decision.rows).toEqual([
      { restatement_text: null, restatement_notes: null, restatement_reason: null },
    ]);
    const history = await getDbExec().execute({
      sql: `SELECT operator_notes FROM gr_decision_history WHERE id = ?`,
      args: [historyId],
    });
    expect(history.rows).toEqual([{ operator_notes: null }]);

    await getDbExec().execute({
      sql: `UPDATE gr_decisions SET restatement_text = ?, restatement_notes = ?, restatement_reason = ? WHERE id = ?`,
      args: ["Stripe.", "Claude, double-check the fee table.", "Removed a note to the AI.", decisionId],
    });
    await getDbExec().execute({
      sql: `UPDATE gr_decision_history SET operator_notes = ? WHERE id = ?`,
      args: ["Claude, double-check the fee table.", historyId],
    });
    const updated = await getDbExec().execute({
      sql: `SELECT d.restatement_text, d.restatement_notes, d.restatement_reason, h.operator_notes
            FROM gr_decisions d JOIN gr_decision_history h ON h.decision_id = d.id WHERE d.id = ?`,
      args: [decisionId],
    });
    expect(updated.rows).toEqual([
      {
        restatement_text: "Stripe.",
        restatement_notes: "Claude, double-check the fee table.",
        restatement_reason: "Removed a note to the AI.",
        operator_notes: "Claude, double-check the fee table.",
      },
    ]);
  });
});

describe("turn-attempts-usage-columns migration", () => {
  beforeEach(dropSchema);

  const usageColumns = [
    "input_tokens",
    "output_tokens",
    "cache_read_tokens",
    "cache_creation_tokens",
    "cost_usd",
    "cli_turns",
    "cli_duration_ms",
    "cli_api_duration_ms",
    "session_id",
    "tool_calls_json",
  ].join(", ");

  it("adds nullable usage columns to turn attempts on a database at v68, leaving existing attempts without usage", async () => {
    const before = appMigrations.filter((migration) => migration.version <= 68);
    await applyMigrations(before, MIGRATIONS_TABLE);

    const now = new Date().toISOString();
    const sessionId = randomUUID();
    const turnId = randomUUID();
    const runId = randomUUID();
    const attemptId = randomUUID();
    await getDbExec().execute({
      sql: `INSERT INTO gr_sessions (id, title, idea, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`,
      args: [sessionId, "Grill Room", "An idea.", now, now],
    });
    await getDbExec().execute({
      sql: `INSERT INTO gr_turns (id, session_id, turn_kind, model, started_at) VALUES (?, ?, ?, ?, ?)`,
      args: [turnId, sessionId, "propose-round", "sonnet", now],
    });
    await getDbExec().execute({
      sql: `INSERT INTO gr_turn_runs (id, turn_id, run_number, created_at) VALUES (?, ?, ?, ?)`,
      args: [runId, turnId, 1, now],
    });
    await getDbExec().execute({
      sql: `INSERT INTO gr_turn_attempts (id, run_id, attempt_number, started_at, duration_ms, kind) VALUES (?, ?, ?, ?, ?, ?)`,
      args: [attemptId, runId, 1, now, 1200, "success"],
    });

    await applyMigrations(appMigrations, MIGRATIONS_TABLE);

    const { rows } = await getDbExec().execute({
      sql: `SELECT ${usageColumns} FROM gr_turn_attempts WHERE id = ?`,
      args: [attemptId],
    });
    expect(rows).toEqual([
      {
        input_tokens: null,
        output_tokens: null,
        cache_read_tokens: null,
        cache_creation_tokens: null,
        cost_usd: null,
        cli_turns: null,
        cli_duration_ms: null,
        cli_api_duration_ms: null,
        session_id: null,
        tool_calls_json: null,
      },
    ]);

    await getDbExec().execute({
      sql: `UPDATE gr_turn_attempts SET input_tokens = ?, output_tokens = ?, cache_read_tokens = ?, cache_creation_tokens = ?, cost_usd = ?, cli_turns = ?, cli_duration_ms = ?, cli_api_duration_ms = ?, session_id = ?, tool_calls_json = ? WHERE id = ?`,
      args: [10, 165, 9_000_000_000_000, 33442, 0.0691046, 3, 4188, 3601, "session-7", '{"Read":2}', attemptId],
    });
    const updated = await getDbExec().execute({
      sql: `SELECT ${usageColumns} FROM gr_turn_attempts WHERE id = ?`,
      args: [attemptId],
    });
    expect(updated.rows).toEqual([
      {
        input_tokens: 10,
        output_tokens: 165,
        cache_read_tokens: 9_000_000_000_000,
        cache_creation_tokens: 33442,
        cost_usd: 0.0691046,
        cli_turns: 3,
        cli_duration_ms: 4188,
        cli_api_duration_ms: 3601,
        session_id: "session-7",
        tool_calls_json: '{"Read":2}',
      },
    ]);
  });
});

describe("tickets-kind-columns migration", () => {
  beforeEach(dropSchema);

  it("reads an existing ticket as a build with no waitsFor, and round-trips a gate, on a database at the previous version", async () => {
    const migration = appMigrations.find((entry) => entry.name === "tickets-kind-columns")!;
    const before = appMigrations.filter((entry) => entry.version < migration.version);
    await applyMigrations(before, MIGRATIONS_TABLE);

    const now = new Date().toISOString();
    const sessionId = randomUUID();
    const buildId = randomUUID();
    const gateId = randomUUID();
    await getDbExec().execute({
      sql: `INSERT INTO gr_sessions (id, title, idea, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`,
      args: [sessionId, "Grill Room", "An idea.", now, now],
    });
    await getDbExec().execute({
      sql: `INSERT INTO gr_tickets (id, session_id, number, slug, title, body, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [buildId, sessionId, 1, "build-the-workspace", "Build the workspace", "", now, now],
    });

    await applyMigrations(appMigrations, MIGRATIONS_TABLE);

    const existing = await getDbExec().execute({
      sql: `SELECT kind, waits_for FROM gr_tickets WHERE id = ?`,
      args: [buildId],
    });
    expect(existing.rows).toEqual([{ kind: "build", waits_for: null }]);

    await getDbExec().execute({
      sql: `INSERT INTO gr_tickets (id, session_id, number, slug, title, body, kind, waits_for, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        gateId,
        sessionId,
        2,
        "payment-account",
        "Payment account is live",
        "",
        "gate",
        "A live account on the payment platform, with API keys issued.",
        now,
        now,
      ],
    });
    const gate = await getDbExec().execute({
      sql: `SELECT kind, waits_for FROM gr_tickets WHERE id = ?`,
      args: [gateId],
    });
    expect(gate.rows).toEqual([
      { kind: "gate", waits_for: "A live account on the payment platform, with API keys issued." },
    ]);
  });
});

describe("handoffs-markdown-generated-sha256 migration", () => {
  beforeEach(dropSchema);

  it("adds a nullable markdown_generated_sha256 to handoffs on a database at v70, leaving an existing handoff without one", async () => {
    const before = appMigrations.filter((migration) => migration.version <= 70);
    await applyMigrations(before, MIGRATIONS_TABLE);

    const now = new Date().toISOString();
    const sessionId = randomUUID();
    const handoffId = randomUUID();
    await getDbExec().execute({
      sql: `INSERT INTO gr_sessions (id, title, idea, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`,
      args: [sessionId, "Grill Room", "An idea.", now, now],
    });
    await getDbExec().execute({
      sql: `INSERT INTO gr_handoffs (id, session_id, markdown, briefs_json, fingerprint, generated_at, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [handoffId, sessionId, "# Handoff\n", "[]", "a-fingerprint", now, now, now],
    });

    await applyMigrations(appMigrations, MIGRATIONS_TABLE);

    const { rows } = await getDbExec().execute({
      sql: `SELECT markdown_generated_sha256 FROM gr_handoffs WHERE id = ?`,
      args: [handoffId],
    });
    expect(rows).toEqual([{ markdown_generated_sha256: null }]);

    await getDbExec().execute({
      sql: `UPDATE gr_handoffs SET markdown_generated_sha256 = ? WHERE id = ?`,
      args: ["a-baseline", handoffId],
    });
    const updated = await getDbExec().execute({
      sql: `SELECT markdown_generated_sha256 FROM gr_handoffs WHERE id = ?`,
      args: [handoffId],
    });
    expect(updated.rows).toEqual([{ markdown_generated_sha256: "a-baseline" }]);
  });
});

describe("tickets-implements-column migration", () => {
  beforeEach(dropSchema);

  it("reads an existing ticket's implements_json as NULL, and round-trips a value, on a database at the previous version", async () => {
    const migration = appMigrations.find((entry) => entry.name === "tickets-implements-column")!;
    const before = appMigrations.filter((entry) => entry.version < migration.version);
    await applyMigrations(before, MIGRATIONS_TABLE);

    const now = new Date().toISOString();
    const sessionId = randomUUID();
    const ticketId = randomUUID();
    await getDbExec().execute({
      sql: `INSERT INTO gr_sessions (id, title, idea, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`,
      args: [sessionId, "Grill Room", "An idea.", now, now],
    });
    await getDbExec().execute({
      sql: `INSERT INTO gr_tickets (id, session_id, number, slug, title, body, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [ticketId, sessionId, 1, "build-the-workspace", "Build the workspace", "", now, now],
    });

    await applyMigrations(appMigrations, MIGRATIONS_TABLE);

    const existing = await getDbExec().execute({
      sql: `SELECT implements_json FROM gr_tickets WHERE id = ?`,
      args: [ticketId],
    });
    expect(existing.rows).toEqual([{ implements_json: null }]);

    await getDbExec().execute({
      sql: `UPDATE gr_tickets SET implements_json = ? WHERE id = ?`,
      args: ["[1,2]", ticketId],
    });
    const updated = await getDbExec().execute({
      sql: `SELECT implements_json FROM gr_tickets WHERE id = ?`,
      args: [ticketId],
    });
    expect(updated.rows).toEqual([{ implements_json: "[1,2]" }]);
  });
});

describe("projects-max-tickets-in-flight-column migration", () => {
  beforeEach(dropSchema);

  it("reads an existing project's max_tickets_in_flight as 3, and round-trips a value, on a database at the previous version", async () => {
    const migration = appMigrations.find(
      (entry) => entry.name === "projects-max-tickets-in-flight-column",
    )!;
    const before = appMigrations.filter((entry) => entry.version < migration.version);
    await applyMigrations(before, MIGRATIONS_TABLE);

    const id = randomUUID();
    const now = new Date().toISOString();
    await getDbExec().execute({
      sql: `INSERT INTO gr_projects (id, name, root_path, verify_command, working_export_folder, visibility, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [id, "Grill Room", "/repos/grill-room", "pnpm test", ".scratch", "tracked", now, now],
    });

    await applyMigrations(appMigrations, MIGRATIONS_TABLE);

    const existing = await getDbExec().execute({
      sql: `SELECT max_tickets_in_flight FROM gr_projects WHERE id = ?`,
      args: [id],
    });
    expect(existing.rows).toEqual([{ max_tickets_in_flight: 3 }]);

    await getDbExec().execute({
      sql: `UPDATE gr_projects SET max_tickets_in_flight = ? WHERE id = ?`,
      args: [7, id],
    });
    const updated = await getDbExec().execute({
      sql: `SELECT max_tickets_in_flight FROM gr_projects WHERE id = ?`,
      args: [id],
    });
    expect(updated.rows).toEqual([{ max_tickets_in_flight: 7 }]);
  });
});
