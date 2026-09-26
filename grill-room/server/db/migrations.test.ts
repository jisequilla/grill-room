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
