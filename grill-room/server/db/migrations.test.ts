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
