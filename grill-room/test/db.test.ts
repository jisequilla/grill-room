import { getDbExec, getRuntimeDatabaseUrl } from "@agent-native/core/db";
import { describe, expect, it } from "vitest";

import createSession from "../actions/create-session.js";
import setSetting from "../actions/set-setting.js";
import {
  getDb,
  rebuildTestSchema,
  resetTestDatabase,
  schema,
  useTestDatabase,
} from "./db.js";
import { IN_MEMORY_DATABASE_URL } from "./setup.js";

// Two blocks, each registering the lifecycle, is the shape that broke when the
// harness closed the database in `afterAll`: the framework invalidates the
// memoized Drizzle handle on its pooled Postgres branches only, so the second
// block queried a closed PGlite. Keep both blocks.
describe("useTestDatabase, first block", () => {
  useTestDatabase();

  it("runs an action against the in-memory database", async () => {
    await setSetting.run({ key: "a", value: "1" });
    expect(await getDb().select().from(schema.globalSettings)).toHaveLength(1);
  });
});

describe("useTestDatabase, a later block in the same file", () => {
  useTestDatabase();

  it("still has a live database", async () => {
    await setSetting.run({ key: "b", value: "2" });
    expect(await getDb().select().from(schema.globalSettings)).toEqual([
      { key: "b", value: "2" },
    ]);
  });
});

// The schema is built once per file and only emptied per test, so isolation is
// now a property of the reset rather than of a rebuild. These five tests are
// what stands between that optimisation and tests that leak into each other.
describe("per-test isolation", () => {
  useTestDatabase();

  it("leaves rows behind for the next test to not find", async () => {
    await setSetting.run({ key: "leaked", value: "yes" });
    await createSession.run({
      title: "Leaky",
      idea: "A session that persists",
    });
    expect(await getDb().select().from(schema.sessions)).toHaveLength(1);
  });

  it("starts empty, in every table the previous test wrote to", async () => {
    expect(await getDb().select().from(schema.globalSettings)).toEqual([]);
    expect(await getDb().select().from(schema.sessions)).toEqual([]);
  });

  it("keeps the full schema across a reset, not just the tables it emptied", async () => {
    const { rows } = await getDbExec().execute(
      `SELECT tablename FROM pg_tables WHERE schemaname = 'public'`,
    );
    const tables = rows.map((row) =>
      String((row as { tablename: unknown }).tablename),
    );
    expect(tables).toEqual(
      expect.arrayContaining([
        "gr_global_settings",
        "gr_sessions",
        "gr_decisions",
        "gr_decision_history",
        "gr_rounds",
        "gr_round_decisions",
        "gr_specs",
        "gr_tickets",
        "gr_build_records",
      ]),
    );
  });

  it("empties children along with their parent", async () => {
    const session = await createSession.run({
      title: "Cascade",
      idea: "A session with a decision under it",
    });
    await getDb().insert(schema.decisions).values({
      id: "d1",
      sessionId: session.id,
      questionTitle: "A question",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    await resetTestDatabase();

    expect(await getDb().select().from(schema.decisions)).toEqual([]);
    expect(await getDb().select().from(schema.sessions)).toEqual([]);
  });

  it("rebuilds the schema when a test has changed it", async () => {
    await getDbExec().execute("CREATE TABLE scratch_table (id TEXT)");
    await rebuildTestSchema();

    const { rows } = await getDbExec().execute(
      `SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename = 'scratch_table'`,
    );
    expect(rows).toEqual([]);
    expect(await getDb().select().from(schema.sessions)).toEqual([]);
  });
});

describe("the in-memory pin", () => {
  it("refuses to reset anything but the in-memory instance", async () => {
    process.env.DATABASE_URL = "pglite:./data/pglite";
    try {
      await expect(resetTestDatabase()).rejects.toThrow(/Refusing to reset/);
    } finally {
      process.env.DATABASE_URL = IN_MEMORY_DATABASE_URL;
    }
  });

  it("is why setup.ts clears a per-app prefixed url, which outranks DATABASE_URL", () => {
    process.env.APP_NAME = "grill-room";
    process.env.GRILL_ROOM_DATABASE_URL = "pglite:./data/pglite";
    try {
      expect(getRuntimeDatabaseUrl()).toBe("pglite:./data/pglite");
    } finally {
      delete process.env.GRILL_ROOM_DATABASE_URL;
      delete process.env.APP_NAME;
    }
    expect(getRuntimeDatabaseUrl()).toBe(IN_MEMORY_DATABASE_URL);
  });
});
