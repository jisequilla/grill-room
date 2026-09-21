import { eq } from "@agent-native/core/db/schema";
import { describe, expect, it } from "vitest";

import { getDb, schema, useTestDatabase } from "../test/db.js";
import confirmSession from "./confirm-session.js";
import createSession from "./create-session.js";
import dispositionDecision from "./disposition-decision.js";
import getSession from "./get-session.js";

function aSession() {
  return createSession.run({
    title: "Grill Room",
    idea: "A local app that grills me about an idea until it is decided.",
  });
}

/** Inserts a decision row directly, bypassing the interviewer and any round. */
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

async function markDoneProposed(sessionId: string) {
  await getDb()
    .update(schema.sessions)
    .set({ state: "done-proposed", doneSummary: "Nothing left, we thought." })
    .where(eq(schema.sessions.id, sessionId));
}

describe("confirm-session", () => {
  useTestDatabase();

  it("throws for a session id that does not exist", async () => {
    await expect(confirmSession.run({ sessionId: "missing" })).rejects.toThrow(
      "Session not found: missing",
    );
  });

  it("refuses a session that is still interviewing", async () => {
    const session = await aSession();

    await expect(
      confirmSession.run({ sessionId: session.id }),
    ).rejects.toThrow(/done proposal can be confirmed.*is interviewing/);

    expect(await getSession.run({ id: session.id })).toMatchObject({
      state: "interviewing",
    });
  });

  it("refuses while loose ends remain, listing them", async () => {
    const session = await aSession();
    await insertDecision(session.id, {
      id: "d-unknown",
      key: "unknown-key",
      questionTitle: "What theme?",
      answerKind: "unknown",
    });
    await markDoneProposed(session.id);

    await expect(
      confirmSession.run({ sessionId: session.id }),
    ).rejects.toMatchObject({
      errorCode: "loose-ends-remain",
      details: {
        looseEnds: [
          expect.objectContaining({ key: "unknown-key", reason: "unknown" }),
        ],
      },
    });

    expect(await getSession.run({ id: session.id })).toMatchObject({
      state: "done-proposed",
    });
  });

  it("refuses while a turn is working", async () => {
    const session = await aSession();
    await markDoneProposed(session.id);
    await getDb()
      .update(schema.sessions)
      .set({ turnStatus: "working", turnStartedAt: new Date().toISOString() })
      .where(eq(schema.sessions.id, session.id));

    await expect(
      confirmSession.run({ sessionId: session.id }),
    ).rejects.toThrow(/interviewer is working/);
  });

  it("confirms once every loose end has a real answer or a disposition", async () => {
    const session = await aSession();
    await insertDecision(session.id, {
      id: "d-unknown",
      key: "unknown-key",
      questionTitle: "What theme?",
      answerKind: "unknown",
    });
    await dispositionDecision.run({
      decisionId: "d-unknown",
      target: "out-of-scope",
      note: "Later.",
    });
    await markDoneProposed(session.id);

    const result = await confirmSession.run({ sessionId: session.id });

    expect(result).toMatchObject({ state: "confirmed" });
    expect(await getSession.run({ id: session.id })).toMatchObject({
      state: "confirmed",
    });
  });
});
