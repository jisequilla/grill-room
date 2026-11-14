import { beforeEach, describe, expect, it } from "vitest";

import { setTechnicalLevel } from "../server/owner-profiles.js";
import { LOCAL_OWNER_ID } from "../shared/session-constants.js";
import { getDb, schema, useTestDatabase } from "../test/db.js";
import getOwnerProfile from "./get-owner-profile.js";

describe("get-owner-profile", () => {
  useTestDatabase();

  beforeEach(async () => {
    await getDb().delete(schema.ownerProfiles);
  });

  it("G1: reports a null level when none is set", async () => {
    expect(await getOwnerProfile.run({})).toEqual({
      ownerId: LOCAL_OWNER_ID,
      technicalLevel: null,
    });
  });

  it("G2: reports the level that is set", async () => {
    await setTechnicalLevel(LOCAL_OWNER_ID, "technical-not-building");

    expect(await getOwnerProfile.run({})).toEqual({
      ownerId: LOCAL_OWNER_ID,
      technicalLevel: "technical-not-building",
    });
  });
});
