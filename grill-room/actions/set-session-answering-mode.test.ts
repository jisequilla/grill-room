import { describe, expect, it } from "vitest";

import { useTestDatabase } from "../test/db.js";
import createSession from "./create-session.js";
import getSession from "./get-session.js";
import setSessionAnsweringMode from "./set-session-answering-mode.js";

describe("set-session-answering-mode", () => {
  useTestDatabase();

  it("switches a session from whole-round to one-at-a-time", async () => {
    const session = await createSession.run({
      title: "Marathon tracker",
      idea: "A PWA for 16-week marathon training",
    });
    expect(session.answeringMode).toBe("whole-round");

    const updated = await setSessionAnsweringMode.run({
      id: session.id,
      answeringMode: "one-at-a-time",
    });

    expect(updated.answeringMode).toBe("one-at-a-time");
    expect(await getSession.run({ id: session.id })).toMatchObject({
      answeringMode: "one-at-a-time",
    });
  });

  it("switches back from one-at-a-time to whole-round", async () => {
    const session = await createSession.run({
      title: "Marathon tracker",
      idea: "A PWA for 16-week marathon training",
      answeringMode: "one-at-a-time",
    });

    const updated = await setSessionAnsweringMode.run({
      id: session.id,
      answeringMode: "whole-round",
    });

    expect(updated.answeringMode).toBe("whole-round");
  });

  it("throws for a session id that does not exist", async () => {
    await expect(
      setSessionAnsweringMode.run({ id: "missing", answeringMode: "whole-round" }),
    ).rejects.toThrow("Session not found: missing");
  });
});
