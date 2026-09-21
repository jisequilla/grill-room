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
 *
 * ## What a reset does, and does not, undo
 *
 * The schema is built once per test file; each test then gets its tables
 * emptied, not rebuilt. Rows, and any sequence they advanced, are gone between
 * tests. Schema a test creates itself — an extra table, an added column — is
 * not, because nothing in this app does that. A test that needs its own DDL
 * should call `rebuildTestSchema()` afterwards.
 */
import { getDbExec, getRuntimeDatabaseUrl } from "@agent-native/core/db";
import { beforeEach } from "vitest";

import { getDb, schema } from "../server/db/index.js";
import { appMigrations, MIGRATIONS_TABLE } from "../server/db/migrations.js";
import { IN_MEMORY_DATABASE_URL } from "./setup.js";

/** Bookkeeping rows survive a reset; re-running migrations per test is the cost this avoids. */
const BOOKKEEPING_TABLES = new Set([
  MIGRATIONS_TABLE,
  `${MIGRATIONS_TABLE}_named`,
]);

/**
 * Whether this worker has built the schema yet. Vitest gives each test file its
 * own module registry, so this is effectively once per file — which is also how
 * often the PGlite instance behind it is created.
 */
let schemaBuilt = false;

function statementFor(sql: (typeof appMigrations)[number]["sql"]) {
  return typeof sql === "string" ? sql : sql.postgres;
}

function assertInMemory(): void {
  const url = getRuntimeDatabaseUrl();
  if (url !== IN_MEMORY_DATABASE_URL) {
    throw new Error(
      `Refusing to reset a database that is not the in-memory test instance: ${url}`,
    );
  }
}

/** Drop everything and apply the app's migrations from scratch. */
export async function rebuildTestSchema(): Promise<void> {
  assertInMemory();

  const exec = getDbExec();
  await exec.execute("DROP SCHEMA IF EXISTS public CASCADE");
  await exec.execute("CREATE SCHEMA public");

  const ordered = [...appMigrations].sort((a, b) => a.version - b.version);
  for (const migration of ordered) {
    const statement = statementFor(migration.sql);
    if (statement) await exec.execute(statement);
    await migration.run?.(exec);
  }
  schemaBuilt = true;
}

async function emptyAppTables(): Promise<void> {
  const exec = getDbExec();
  const { rows } = await exec.execute(
    `SELECT tablename FROM pg_tables WHERE schemaname = 'public'`,
  );
  const tables = rows
    .map((row) => String((row as { tablename: unknown }).tablename))
    .filter((name) => !BOOKKEEPING_TABLES.has(name));
  if (tables.length === 0) return;
  await exec.execute(
    `TRUNCATE TABLE ${tables.map((name) => `"${name}"`).join(", ")} RESTART IDENTITY CASCADE`,
  );
}

/**
 * Give the next test an empty database.
 *
 * The first call in a worker builds the schema; later calls only empty it. The
 * split is what keeps the suite green as test files multiply: building it was
 * never the expensive part (a full rebuild measures ~15-40 ms) but every
 * millisecond of per-test CPU competes with other workers booting their own
 * PGlite instance, which is the real cost. See `vitest.config.ts`.
 */
export async function resetTestDatabase(): Promise<void> {
  assertInMemory();
  if (!schemaBuilt) {
    await rebuildTestSchema();
    return;
  }
  await emptyAppTables();
}

/**
 * Register the per-test database lifecycle. Safe to call in more than one
 * `describe` in the same file, or at the top level of a file.
 *
 * Deliberately no teardown. `closeDbExec()` closes the PGlite instance without
 * invalidating the Drizzle handle that `createGetDb` memoized at module scope —
 * the framework registers that invalidation hook on its pooled Postgres
 * branches only. A second `describe` would then query a closed database. Vitest
 * gives each test file its own worker process, so the instance is released when
 * the file ends either way.
 */
export function useTestDatabase(): void {
  beforeEach(resetTestDatabase);
}

export { getDb, schema };
