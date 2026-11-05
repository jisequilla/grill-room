import { eq } from "@agent-native/core/db/schema";
import { describe, expect, it } from "vitest";

import { getDb, schema, useTestDatabase } from "../test/db.js";
import {
  getOrCreateOwnerProfile,
  getTechnicalLevel,
  setTechnicalLevel,
} from "./owner-profiles.js";

const UNKNOWN_EXPERT =
  'Unknown technical level "expert": expected one of builder, technical-not-building, not-technical, or null.';

async function profileRows(userId: string) {
  return getDb()
    .select()
    .from(schema.ownerProfiles)
    .where(eq(schema.ownerProfiles.userId, userId));
}

describe("owner profiles", () => {
  useTestDatabase();

  it("5: reads a missing profile's level as null without creating a row", async () => {
    expect(await getTechnicalLevel("u1")).toBeNull();
    expect(await profileRows("u1")).toEqual([]);
  });

  it("6: creates a profile with no level once, however often it is asked for", async () => {
    const first = await getOrCreateOwnerProfile("u1");
    const second = await getOrCreateOwnerProfile("u1");
    expect(first).toEqual({ userId: "u1", technicalLevel: null });
    expect(second).toEqual({ userId: "u1", technicalLevel: null });
    expect(await profileRows("u1")).toHaveLength(1);
  });

  it("6b: returns the stored level of an owner who has one", async () => {
    await setTechnicalLevel("u3", "builder");
    expect(await getOrCreateOwnerProfile("u3")).toEqual({
      userId: "u3",
      technicalLevel: "builder",
    });
    expect(await profileRows("u3")).toHaveLength(1);
  });

  it("7: setting a level creates the profile when there is none", async () => {
    await setTechnicalLevel("u1", "builder");
    expect(await profileRows("u1")).toHaveLength(1);
    expect(await getTechnicalLevel("u1")).toBe("builder");
  });

  it("8: setting null clears a stored level", async () => {
    await setTechnicalLevel("u1", "builder");
    await setTechnicalLevel("u1", null);
    expect(await getTechnicalLevel("u1")).toBeNull();
  });

  it("9: refuses an unknown level, leaving an existing level and creating no row", async () => {
    await setTechnicalLevel("u1", "builder");
    await expect(setTechnicalLevel("u1", "expert" as never)).rejects.toThrow(
      UNKNOWN_EXPERT,
    );
    expect(await getTechnicalLevel("u1")).toBe("builder");

    await expect(setTechnicalLevel("u2", "expert" as never)).rejects.toThrow(
      UNKNOWN_EXPERT,
    );
    expect(await profileRows("u2")).toEqual([]);
  });
});
