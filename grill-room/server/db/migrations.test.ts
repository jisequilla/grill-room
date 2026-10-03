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
import { hashExportContent } from "../export.js";
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

describe("consistency-findings-table migration", () => {
  beforeEach(dropSchema);

  it("creates the reopen cards table and its index, and reads an existing spec as never checked, on a database at the previous version", async () => {
    const migration = appMigrations.find((entry) => entry.name === "consistency-findings-table")!;
    const before = appMigrations.filter((entry) => entry.version < migration.version);
    expect(before[before.length - 1]!.name).toBe("projects-max-tickets-in-flight-column");
    await applyMigrations(before, MIGRATIONS_TABLE);

    const now = new Date().toISOString();
    const sessionId = randomUUID();
    const specId = randomUUID();
    await getDbExec().execute({
      sql: `INSERT INTO gr_sessions (id, title, idea, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`,
      args: [sessionId, "Grill Room", "An idea.", now, now],
    });
    await getDbExec().execute({
      sql: `INSERT INTO gr_specs (id, session_id, markdown, tickets_generated_at, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?)`,
      args: [specId, sessionId, "## Problem Statement\n", now, now, now],
    });

    await applyMigrations(appMigrations, MIGRATIONS_TABLE);

    const spec = await getDbExec().execute({
      sql: `SELECT consistency_checked_for, consistency_turn_id FROM gr_specs WHERE id = ?`,
      args: [specId],
    });
    expect(spec.rows).toEqual([{ consistency_checked_for: null, consistency_turn_id: null }]);

    const index = await getDbExec().execute({
      sql: `SELECT tablename FROM pg_indexes WHERE indexname = ?`,
      args: ["gr_idx_consistency_findings_session"],
    });
    expect(index.rows).toEqual([{ tablename: "gr_consistency_findings" }]);

    await getDbExec().execute({
      sql: `INSERT INTO gr_consistency_findings (id, session_id, number, kind, at_json, question, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [randomUUID(), sessionId, 1, "open-choice", "{}", "Which?", now, now],
    });
    const card = await getDbExec().execute({
      sql: `SELECT status, against_json, decision_key FROM gr_consistency_findings WHERE session_id = ?`,
      args: [sessionId],
    });
    expect(card.rows).toEqual([{ status: "open", against_json: null, decision_key: null }]);
  });
});

describe("consistency-findings-decision-column migration", () => {
  beforeEach(dropSchema);

  it("adds the card's decision and the spec's attempt stamp and hash, backfilling both from the checked stamp and the markdown, on a database at the previous version", async () => {
    const migration = appMigrations.find(
      (entry) => entry.name === "consistency-findings-decision-column",
    )!;
    const before = appMigrations.filter((entry) => entry.version < migration.version);
    expect(before[before.length - 1]!.name).toBe("consistency-findings-session-index");
    await applyMigrations(before, MIGRATIONS_TABLE);

    const now = new Date().toISOString();
    const checkedAt = "2026-09-01T10:00:00.000Z";
    const specs = [
      { id: randomUUID(), markdown: "## Problem Statement\n\nChecked.\n", checked: checkedAt },
      {
        id: randomUUID(),
        markdown: "## Problem Statement\r\n\r\nChecked, with CRLF line ends.\r\n",
        checked: checkedAt,
      },
      { id: randomUUID(), markdown: "## Problem Statement\n\nNever checked.\n", checked: null },
    ];
    const sessionIds: string[] = [];
    for (const spec of specs) {
      const sessionId = randomUUID();
      sessionIds.push(sessionId);
      await getDbExec().execute({
        sql: `INSERT INTO gr_sessions (id, title, idea, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`,
        args: [sessionId, "Grill Room", "An idea.", now, now],
      });
      await getDbExec().execute({
        sql: `INSERT INTO gr_specs (id, session_id, markdown, tickets_generated_at, consistency_checked_for, created_at, updated_at)
              VALUES (?, ?, ?, ?, ?, ?, ?)`,
        args: [spec.id, sessionId, spec.markdown, checkedAt, spec.checked, now, now],
      });
    }
    const cardId = randomUUID();
    await getDbExec().execute({
      sql: `INSERT INTO gr_consistency_findings (id, session_id, number, kind, at_json, question, status, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [cardId, sessionIds[0], 1, "open-choice", "{}", "Which?", "dismissed", now, now],
    });

    await applyMigrations(appMigrations, MIGRATIONS_TABLE);

    const card = await getDbExec().execute({
      sql: `SELECT status, decision_id FROM gr_consistency_findings WHERE id = ?`,
      args: [cardId],
    });
    expect(card.rows).toEqual([{ status: "dismissed", decision_id: null }]);

    const stamps = [];
    for (const spec of specs) {
      const { rows } = await getDbExec().execute({
        sql: `SELECT consistency_attempted_for, consistency_spec_sha256 FROM gr_specs WHERE id = ?`,
        args: [spec.id],
      });
      stamps.push(rows[0]);
    }
    expect(stamps).toEqual([
      { consistency_attempted_for: checkedAt, consistency_spec_sha256: hashExportContent(specs[0]!.markdown) },
      { consistency_attempted_for: checkedAt, consistency_spec_sha256: hashExportContent(specs[1]!.markdown) },
      { consistency_attempted_for: null, consistency_spec_sha256: null },
    ]);
  });
});

describe("handoff-repo-rules-storage migration", () => {
  beforeEach(dropSchema);

  it("reads an existing project's preflight_step as true and its delegation columns as null, and round-trips each, on a database at the previous version", async () => {
    const migration = appMigrations.find((entry) => entry.name === "handoff-repo-rules-storage")!;
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

    const select = `SELECT preflight_step, delegation_values_json, delegation_proposals_json FROM gr_projects WHERE id = ?`;
    const existing = await getDbExec().execute({ sql: select, args: [id] });
    expect(existing.rows).toEqual([
      { preflight_step: true, delegation_values_json: null, delegation_proposals_json: null },
    ]);

    await getDbExec().execute({
      sql: `UPDATE gr_projects SET preflight_step = ?, delegation_values_json = ?, delegation_proposals_json = ? WHERE id = ?`,
      args: [false, '{"a":1}', '{"b":2}', id],
    });
    const updated = await getDbExec().execute({ sql: select, args: [id] });
    expect(updated.rows).toEqual([
      { preflight_step: false, delegation_values_json: '{"a":1}', delegation_proposals_json: '{"b":2}' },
    ]);
  });

  it("stores a rule waiver and drops it when its ticket is deleted", async () => {
    await applyMigrations(appMigrations, MIGRATIONS_TABLE);

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
      args: [ticketId, sessionId, 1, "one", "One", "Body.", now, now],
    });
    await getDbExec().execute({
      sql: `INSERT INTO gr_rule_waivers (id, session_id, ticket_id, rule_path, missing_files_json, reason, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)`,
      args: [randomUUID(), sessionId, ticketId, ".claude/rules/x.md", '["a.ts"]', "Not needed.", now],
    });

    const stored = await getDbExec().execute({
      sql: `SELECT rule_path, missing_files_json, reason FROM gr_rule_waivers WHERE session_id = ?`,
      args: [sessionId],
    });
    expect(stored.rows).toEqual([
      { rule_path: ".claude/rules/x.md", missing_files_json: '["a.ts"]', reason: "Not needed." },
    ]);

    await getDbExec().execute({ sql: `DELETE FROM gr_tickets WHERE id = ?`, args: [ticketId] });
    const dropped = await getDbExec().execute({
      sql: `SELECT id FROM gr_rule_waivers WHERE session_id = ?`,
      args: [sessionId],
    });
    expect(dropped.rows).toEqual([]);
  });
});
