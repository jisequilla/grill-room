import { eq } from "@agent-native/core/db/schema";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  resetInterviewer,
  scriptInterviewer,
} from "../server/interviewer/index.js";
import { anAssessReadinessResult } from "../server/interviewer/test-fixtures.js";
import { getDb, schema, useTestDatabase } from "../test/db.js";
import assessReadiness from "./assess-readiness.js";
import addDecision from "./add-decision.js";
import createSession from "./create-session.js";
import listLooseEnds from "./list-loose-ends.js";
import listSessions from "./list-sessions.js";
import reopenDecision from "./reopen-decision.js";

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

  describe("looseEndCount", () => {
    async function insertDecision(
      sessionId: string,
      overrides: Partial<typeof schema.decisions.$inferInsert> & {
        id: string;
        key: string;
        questionTitle: string;
      },
    ) {
      const now = new Date().toISOString();
      await getDb()
        .insert(schema.decisions)
        .values({
          sessionId,
          questionBody: "",
          offeredChoicesJson: "[]",
          dependsOnJson: "[]",
          introducedBy: "interviewer",
          createdAt: now,
          updatedAt: now,
          ...overrides,
        });
    }

    async function insertSettled(sessionId: string, id: string) {
      await insertDecision(sessionId, {
        id,
        key: `${id}-key`,
        questionTitle: id,
        answerKind: "own-answer",
        currentAnswer: "An answer",
        settledAt: new Date().toISOString(),
      });
    }

    async function insertLooseEnd(
      sessionId: string,
      id: string,
      answerKind: "unknown" | "deferred",
    ) {
      await insertDecision(sessionId, {
        id,
        key: `${id}-key`,
        questionTitle: id,
        answerKind,
        currentAnswer: answerKind === "unknown" ? "Not sure" : null,
      });
    }

    async function countOf(sessionId: string) {
      const row = (await listSessions.run({})).find(
        (session) => session.id === sessionId,
      );
      return row?.looseEndCount;
    }

    it("is 0 for a session with no decisions", async () => {
      const session = await createSession.run({ title: "Empty", idea: "One" });
      expect(await countOf(session.id)).toBe(0);
    });

    it("is 0 for a session whose decisions are all settled", async () => {
      const session = await createSession.run({ title: "Settled", idea: "One" });
      await insertSettled(session.id, "d-a");
      await insertSettled(session.id, "d-b");
      expect(await countOf(session.id)).toBe(0);
    });

    it("counts an unknown and a deferred decision but not a settled one", async () => {
      const session = await createSession.run({ title: "Mixed", idea: "One" });
      await insertLooseEnd(session.id, "d-unknown", "unknown");
      await insertLooseEnd(session.id, "d-deferred", "deferred");
      await insertSettled(session.id, "d-settled");
      expect(await countOf(session.id)).toBe(2);
    });

    it("puts each session's count on its own session", async () => {
      const one = await createSession.run({ title: "One", idea: "One" });
      const three = await createSession.run({ title: "Three", idea: "Three" });
      await insertLooseEnd(one.id, "d-1", "unknown");
      await insertLooseEnd(three.id, "d-3a", "unknown");
      await insertLooseEnd(three.id, "d-3b", "deferred");
      await insertLooseEnd(three.id, "d-3c", "deferred");

      expect(await countOf(one.id)).toBe(1);
      expect(await countOf(three.id)).toBe(3);
    });

    it("equals the length of list-loose-ends for a session with every loose-end category", async () => {
      const session = await createSession.run({ title: "Every", idea: "One" });
      const now = new Date().toISOString();
      await insertLooseEnd(session.id, "d-unknown", "unknown");
      await insertLooseEnd(session.id, "d-deferred", "deferred");
      await insertDecision(session.id, {
        id: "d-proto",
        key: "proto-key",
        questionTitle: "Needs a prototype",
        answerKind: "prototype-flagged",
      });
      await insertDecision(session.id, {
        id: "d-pushed",
        key: "pushed-key",
        questionTitle: "Pushed back",
        answerKind: "pushed-back",
        currentAnswer: "Too vague",
      });
      await insertDecision(session.id, {
        id: "d-pushed-withdrawn",
        key: "pushed-withdrawn-key",
        questionTitle: "Pushed back, withdrawn",
        answerKind: "pushed-back",
        currentAnswer: "Too vague",
        withdrawnAt: now,
      });
      await insertDecision(session.id, {
        id: "d-never",
        key: "never-key",
        questionTitle: "Never answered",
      });
      await insertSettled(session.id, "d-settled");
      await insertDecision(session.id, {
        id: "d-base",
        key: "base-key",
        questionTitle: "Base",
        answerKind: "own-answer",
        currentAnswer: "A workspace",
        settledAt: now,
      });
      await insertDecision(session.id, {
        id: "d-dependent",
        key: "dependent-key",
        questionTitle: "Dependent",
        answerKind: "own-answer",
        currentAnswer: "On disk",
        settledAt: now,
        dependsOnJson: JSON.stringify(["d-base"]),
      });
      await addDecision.run({ sessionId: session.id, title: "Unplaced", body: "" });
      await reopenDecision.run({ decisionId: "d-base" });

      const expected = (await listLooseEnds.run({ sessionId: session.id })).length;

      expect(expected).toBeGreaterThan(5);
      expect(await countOf(session.id)).toBe(expected);
    });

    it("reads the decisions table once, however many sessions there are", async () => {
      await createSession.run({ title: "A", idea: "One" });
      await createSession.run({ title: "B", idea: "Two" });
      await createSession.run({ title: "C", idea: "Three" });

      const db = getDb();
      const originalSelect = db.select.bind(db);
      const tablesRead: unknown[] = [];
      const spy = vi.spyOn(db, "select").mockImplementation(((...args: unknown[]) => {
        const builder = (originalSelect as (...a: unknown[]) => any)(...args);
        const originalFrom = builder.from.bind(builder);
        builder.from = (table: unknown, ...rest: unknown[]) => {
          tablesRead.push(table);
          return originalFrom(table, ...rest);
        };
        return builder;
      }) as typeof db.select);

      try {
        await listSessions.run({});
      } finally {
        spy.mockRestore();
      }

      expect(tablesRead.filter((table) => table === schema.decisions)).toHaveLength(1);
    });
  });
});
