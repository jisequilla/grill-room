import { describe, expect, it } from "vitest";

import { getDb, schema, useTestDatabase } from "../test/db.js";
import getSetting from "./get-setting.js";
import setSetting from "./set-setting.js";

describe("global settings actions", () => {
  useTestDatabase();

  it("returns null for a key that was never written", async () => {
    expect(await getSetting.run({ key: "defaultModel" })).toEqual({
      key: "defaultModel",
      value: null,
    });
  });

  it("reads back a value that set-setting wrote", async () => {
    await setSetting.run({ key: "defaultModel", value: "opus" });

    expect(await getSetting.run({ key: "defaultModel" })).toEqual({
      key: "defaultModel",
      value: "opus",
    });
  });

  it("replaces an existing value instead of failing or duplicating", async () => {
    await setSetting.run({ key: "defaultModel", value: "opus" });
    await setSetting.run({ key: "defaultModel", value: "fable" });

    expect(await getSetting.run({ key: "defaultModel" })).toEqual({
      key: "defaultModel",
      value: "fable",
    });
    expect(await getDb().select().from(schema.globalSettings)).toHaveLength(1);
  });

  it("starts each test from an empty database", async () => {
    expect(await getDb().select().from(schema.globalSettings)).toEqual([]);
  });
});
