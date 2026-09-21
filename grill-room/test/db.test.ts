import { getRuntimeDatabaseUrl } from "@agent-native/core/db";
import { describe, expect, it } from "vitest";

import setSetting from "../actions/set-setting.js";
import { getDb, resetTestDatabase, schema, useTestDatabase } from "./db.js";
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
