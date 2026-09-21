import { describe, expect, it } from "vitest";

import { useTestDatabase } from "../test/db.js";
import createSession from "./create-session.js";
import listSessions from "./list-sessions.js";
import setSessionAnsweringMode from "./set-session-answering-mode.js";

describe("list-sessions", () => {
  useTestDatabase();

  it("returns an empty list when no session exists", async () => {
    expect(await listSessions.run({})).toEqual([]);
  });

  it("lists title, state, and last activity for every session", async () => {
    await createSession.run({ title: "First", idea: "Idea one" });
    await createSession.run({ title: "Second", idea: "Idea two" });

    const sessions = await listSessions.run({});

    expect(sessions).toHaveLength(2);
    expect(sessions.map((session) => session.title).sort()).toEqual([
      "First",
      "Second",
    ]);
    for (const session of sessions) {
      expect(session.state).toBe("interviewing");
      expect(session.updatedAt).toBeTruthy();
    }
  });

  it("orders sessions by most recent activity first", async () => {
    const first = await createSession.run({ title: "First", idea: "Idea one" });
    const second = await createSession.run({ title: "Second", idea: "Idea two" });

    // Touching the first session bumps its updatedAt past the second's.
    await setSessionAnsweringMode.run({
      id: first.id,
      answeringMode: "one-at-a-time",
    });

    const sessions = await listSessions.run({});

    expect(sessions.map((session) => session.id)).toEqual([first.id, second.id]);
  });
});
