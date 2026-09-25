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
