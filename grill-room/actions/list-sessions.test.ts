import { eq } from "@agent-native/core/db/schema";
import { afterEach, describe, expect, it } from "vitest";

import {
  resetInterviewer,
  scriptInterviewer,
} from "../server/interviewer/index.js";
import { anAssessReadinessResult } from "../server/interviewer/test-fixtures.js";
import { getDb, schema, useTestDatabase } from "../test/db.js";
import assessReadiness from "./assess-readiness.js";
import createSession from "./create-session.js";
import listSessions from "./list-sessions.js";

describe("list-sessions", () => {
  useTestDatabase();
  afterEach(resetInterviewer);

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

    // Explicit, distinct timestamps set directly through the database: two
    // real action calls can land in the same millisecond, which would make
    // this assertion flaky if it relied on wall-clock gaps between them.
    await getDb()
      .update(schema.sessions)
      .set({ updatedAt: "2024-01-01T00:00:01.000Z" })
      .where(eq(schema.sessions.id, second.id));
    await getDb()
      .update(schema.sessions)
      .set({ updatedAt: "2024-01-01T00:00:02.000Z" })
      .where(eq(schema.sessions.id, first.id));

    const sessions = await listSessions.run({});

    expect(sessions.map((session) => session.id)).toEqual([first.id, second.id]);
  });

  it("breaks a tie in activity by id, so the order is stable rather than arbitrary", async () => {
    const first = await createSession.run({ title: "First", idea: "Idea one" });
    const second = await createSession.run({ title: "Second", idea: "Idea two" });

    const tiedAt = "2024-01-01T00:00:00.000Z";
    await getDb()
      .update(schema.sessions)
      .set({ updatedAt: tiedAt })
      .where(eq(schema.sessions.id, first.id));
    await getDb()
      .update(schema.sessions)
      .set({ updatedAt: tiedAt })
      .where(eq(schema.sessions.id, second.id));

    const expected = [first.id, second.id].sort();

    const sessions = await listSessions.run({});

    expect(sessions.map((session) => session.id)).toEqual(expected);
  });

  it("carries the readiness verdict of each session's current idea", async () => {
    const unjudged = await createSession.run({ title: "Unjudged", idea: "One" });
    const ready = await createSession.run({ title: "Ready", idea: "Two" });
    const notReady = await createSession.run({ title: "Not ready", idea: "Three" });
    const stale = await createSession.run({ title: "Stale", idea: "Four" });
    scriptInterviewer([
      { kind: "assess-readiness", result: anAssessReadinessResult() },
      {
        kind: "assess-readiness",
        result: anAssessReadinessResult({ verdict: "not-ready" }),
      },
      { kind: "assess-readiness", result: anAssessReadinessResult() },
    ]);
    await assessReadiness.run({ sessionId: ready.id });
    await assessReadiness.run({ sessionId: notReady.id });
    await assessReadiness.run({ sessionId: stale.id });
    await getDb()
      .update(schema.sessions)
      .set({ idea: "Four, since edited" })
      .where(eq(schema.sessions.id, stale.id));

    const verdicts = Object.fromEntries(
      (await listSessions.run({})).map((row) => [row.id, row.readinessVerdict]),
    );

    expect(verdicts).toEqual({
      [unjudged.id]: null,
      [ready.id]: "ready",
      [notReady.id]: "not-ready",
      [stale.id]: null,
    });
  });
});
