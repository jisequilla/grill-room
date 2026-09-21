import { describe, expect, it } from "vitest";

import { useTestDatabase } from "../test/db.js";
import createSession from "./create-session.js";
import getSession from "./get-session.js";

describe("get-session", () => {
  useTestDatabase();

  it("returns the session that was created", async () => {
    const created = await createSession.run({
      title: "Marathon tracker",
      idea: "A PWA for 16-week marathon training",
    });

    expect(await getSession.run({ id: created.id })).toEqual(created);
  });

  it("throws for a session id that does not exist", async () => {
    await expect(getSession.run({ id: "missing" })).rejects.toThrow(
      "Session not found: missing",
    );
  });
});
