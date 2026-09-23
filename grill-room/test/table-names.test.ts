/**
 * The app shares one database with the framework.
 *
 * The framework creates well over a hundred generically named tables, and it
 * creates them through the same migration runner, against the same schema. An
 * app table that reuses one of those names does not collide loudly: the app's
 * `CREATE TABLE IF NOT EXISTS` becomes a silent no-op against the framework's
 * table, and the failure only surfaces a few migrations later, as a foreign key
 * to a column that does not exist. That is what `sessions` did.
 *
 * Two checks guard it, because neither is sufficient alone:
 *
 *  1. Better Auth's migration list is the one framework schema exported from a
 *     public entry point, and it is the list that owns `sessions`. Applying it
 *     first and the app's migrations on top reproduces a real boot, so this is
 *     an end-to-end test rather than a naming convention: it fails on the
 *     actual error the app failed with.
 *  2. Everything else the framework creates — `settings`, `documents`,
 *     `resources`, `tools`, and the rest — has no public export to test
 *     against. For those, the `gr_` prefix is the only invariant available, so
 *     it is asserted directly, over the migrations, the Drizzle schema, and the
 *     tables that actually end up in the database.
 */
import { getDbExec, getRuntimeDatabaseUrl } from "@agent-native/core/db";
import { BETTER_AUTH_MIGRATIONS } from "@agent-native/core/server";
import { beforeEach, describe, expect, it } from "vitest";

import { schema } from "../server/db/index.js";
import { appMigrations, MIGRATIONS_TABLE } from "../server/db/migrations.js";
import { applyMigrations } from "./db.js";
import { IN_MEMORY_DATABASE_URL } from "./setup.js";

const APP_TABLE_PREFIX = "gr_";

/** Drizzle records a table's SQL name under this symbol; `getTableName` reads it. */
const DRIZZLE_NAME = Symbol.for("drizzle:Name");

async function listPublicTables(): Promise<string[]> {
  const { rows } = await getDbExec().execute(
    `SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename`,
  );
  return rows.map((row) => String((row as { tablename: unknown }).tablename));
}

function schemaTableNames(): string[] {
  return (Object.values(schema) as unknown[])
    .filter(
      (value): value is Record<symbol, string> =>
        typeof value === "object" && value !== null && DRIZZLE_NAME in value,
    )
    .map((tableDefinition) => tableDefinition[DRIZZLE_NAME]);
}

/** Every table and index `appMigrations` creates or alters, in declaration order. */
function migrationObjectNames(): string[] {
  const patterns = [
    /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?"?(\w+)"?/gi,
    /CREATE\s+(?:UNIQUE\s+)?INDEX\s+(?:IF\s+NOT\s+EXISTS\s+)?"?(\w+)"?/gi,
    /ALTER\s+TABLE\s+"?(\w+)"?/gi,
  ];
  const names: string[] = [];
  for (const migration of appMigrations) {
    const sql =
      typeof migration.sql === "string"
        ? migration.sql
        : migration.sql.postgres;
    if (!sql) continue;
    for (const pattern of patterns) {
      for (const match of sql.matchAll(pattern)) names.push(match[1]!);
    }
  }
  return names;
}

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

describe("app tables next to the framework's", () => {
  beforeEach(dropSchema);

  it("applies cleanly on top of the framework's auth schema", async () => {
    await applyMigrations(BETTER_AUTH_MIGRATIONS, "_better_auth_migrations");
    await applyMigrations(appMigrations, MIGRATIONS_TABLE);

    const tables = await listPublicTables();
    // Better Auth's legacy `sessions` table is the one the app used to shadow.
    expect(tables).toContain("sessions");
    expect(tables).toContain(`${APP_TABLE_PREFIX}sessions`);

    const { rows } = await getDbExec().execute(
      `SELECT column_name FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'sessions'`,
    );
    const frameworkColumns = rows.map((row) =>
      String((row as { column_name: unknown }).column_name),
    );
    expect(frameworkColumns).toContain("token");
    expect(frameworkColumns).not.toContain("idea");
  });

  it("creates only prefixed tables of its own", async () => {
    await applyMigrations(appMigrations, MIGRATIONS_TABLE);

    const tables = await listPublicTables();
    expect(tables.length).toBeGreaterThan(0);
    expect(tables.filter((name) => !name.startsWith(APP_TABLE_PREFIX))).toEqual(
      [],
    );
  });

  it("shares no table name with the framework's auth schema", () => {
    const frameworkTables = new Set(
      BETTER_AUTH_MIGRATIONS.flatMap((migration) => {
        const sql =
          typeof migration.sql === "string"
            ? migration.sql
            : (migration.sql.postgres ?? "");
        return [
          ...sql.matchAll(
            /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?"?(\w+)"?/gi,
          ),
        ].map((match) => match[1]!.toLowerCase());
      }),
    );
    expect(frameworkTables.size).toBeGreaterThan(0);

    const collisions = schemaTableNames().filter((name) =>
      frameworkTables.has(name.toLowerCase()),
    );
    expect(collisions).toEqual([]);
  });
});

describe("the gr_ prefix", () => {
  it("covers every table the Drizzle schema declares", () => {
    const names = schemaTableNames();
    expect(names).toHaveLength(10);
    expect(names.filter((name) => !name.startsWith(APP_TABLE_PREFIX))).toEqual(
      [],
    );
  });

  it("covers every table and index the migrations name", () => {
    const names = migrationObjectNames();
    expect(names.length).toBeGreaterThanOrEqual(appMigrations.length);
    expect(names.filter((name) => !name.startsWith(APP_TABLE_PREFIX))).toEqual(
      [],
    );
  });

  it("covers the migrations bookkeeping table", () => {
    expect(MIGRATIONS_TABLE.startsWith(APP_TABLE_PREFIX)).toBe(true);
  });
});
