/**
 * The action test harness.
 *
 * Every behaviour in this app is tested by calling an action's `run` function
 * against a real database, never a mocked store. `useTestDatabase()` gives each
 * test an empty in-memory PostgreSQL (PGlite) with the app's current schema
 * applied, and actions under test pick it up automatically because `getDb()`
 * resolves `DATABASE_URL` on every call.
 *
 *     import { describe, expect, it } from "vitest";
 *
 *     import getSetting from "./get-setting.js";
 *     import setSetting from "./set-setting.js";
 *     import { useTestDatabase } from "../test/db.js";
 *
 *     describe("get-setting", () => {
 *       useTestDatabase();
 *
 *       it("reads back what set-setting wrote", async () => {
 *         await setSetting.run({ key: "defaultModel", value: "opus" });
 *         expect(await getSetting.run({ key: "defaultModel" })).toEqual({
 *           key: "defaultModel",
 *           value: "opus",
 *         });
 *       });
 *     });
 *
 * Use `getDb()` and `schema` directly when a test needs to arrange rows the
 * actions cannot produce yet, or to assert on state no action exposes.
 *
 * The harness applies `appMigrations`, so it keeps working as later tickets add
 * tables: add the migration, and every test gets the new schema. It creates the
 * app's own tables only — framework stores such as `application_state` and
 * `settings` are not present, so an action under test must reach its data
 * through `getDb()`.
 */
import { closeDbExec, getDbExec, getRuntimeDatabaseUrl } from "@agent-native/core/db";
import { afterAll, beforeEach } from "vitest";

import { getDb, schema } from "../server/db/index.js";
import { appMigrations } from "../server/db/migrations.js";
import { IN_MEMORY_DATABASE_URL } from "./setup.js";

function statementFor(sql: (typeof appMigrations)[number]["sql"]) {
  return typeof sql === "string" ? sql : sql.postgres;
}

/**
 * Drop everything and rebuild the app's schema from its migrations.
 *
 * Cheap enough to run per test — the PGlite instance itself is created once per
 * test file and reused.
 */
export async function resetTestDatabase(): Promise<void> {
  const url = getRuntimeDatabaseUrl();
  if (url !== IN_MEMORY_DATABASE_URL) {
    throw new Error(
      `Refusing to reset a database that is not the in-memory test instance: ${url}`,
    );
  }

  const exec = getDbExec();
  await exec.execute("DROP SCHEMA IF EXISTS public CASCADE");
  await exec.execute("CREATE SCHEMA public");

  const ordered = [...appMigrations].sort((a, b) => a.version - b.version);
  for (const migration of ordered) {
    const statement = statementFor(migration.sql);
    if (statement) await exec.execute(statement);
    await migration.run?.(exec);
  }
}

/**
 * Register the per-test database lifecycle. Call once inside a `describe`, or
 * at the top level of a test file.
 */
export function useTestDatabase(): void {
  beforeEach(resetTestDatabase);
  afterAll(async () => {
    await closeDbExec();
  });
}

export { getDb, schema };
