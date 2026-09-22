import { eq } from "@agent-native/core/db/schema";
import { afterEach, describe, expect, it } from "vitest";

import { resetInterviewer, scriptInterviewer } from "../server/interviewer/index.js";
import { getDb, schema, useTestDatabase } from "../test/db.js";
import createSession from "./create-session.js";
import requestNextRound from "./request-next-round.js";
import setSessionModel from "./set-session-model.js";

/**
 * Proves the "Dedicated action" and "Refusal contract" decisions from
 * `.scratch/change-a-session-s-model-before-its-first-round/spec.md`: a
 * single-purpose action changes a session's model up until the interviewer
 * conversation exists or a turn is working, refuses with the typed
 * `model-locked` error once either holds, and never partially applies a
 * refused change.
 */
describe("set-session-model", () => {
  useTestDatabase();
  afterEach(resetInterviewer);

  function aSession(model: "fable" | "opus" | "sonnet" = "fable") {
    return createSession.run({
      title: "Grill Room",
      idea: "A local app that grills me about an idea until it is decided.",
      model,
    });
  }

  /** A well-formed propose-round result, just enough for the turn to succeed and store a conversation id. */
  function aProposeRoundTurn() {
    return {
      kind: "propose-round" as const,
      result: {
        proposedDecisions: [
          {
            key: "shape",
            title: "What shape should this take?",
            body: "The first thing to settle.",
            choices: [
              { label: "A single page", rationale: "Cheapest to build." },
              { label: "A workspace", rationale: "More layout to get right." },
            ],
            recommendedChoice: 1,
            recommendedAnswer: "A workspace",
            dependsOn: [],
            ask: true,
          },
        ],
        pushBackResponses: [],
        userDecisionPlacements: [],
        done: null,
      },
    };
  }

  async function readRow(sessionId: string) {
    const [row] = await getDb()
      .select()
      .from(schema.sessions)
      .where(eq(schema.sessions.id, sessionId));
    return row!;
  }

  it("accepts a change on a fresh session, and the next turn runs on the new model", async () => {
    const session = await aSession("fable");

    const updated = await setSessionModel.run({
      sessionId: session.id,
      model: "sonnet",
    });
    expect(updated.model).toBe("sonnet");
    expect((await readRow(session.id)).model).toBe("sonnet");

    const interviewer = scriptInterviewer([aProposeRoundTurn()]);
    const result = await requestNextRound.run({ sessionId: session.id });

    expect(result.turnStatus).toBe("idle");
    expect(interviewer.requests).toHaveLength(1);
    expect(interviewer.requests[0]?.context.model).toBe("sonnet");
  });

  it("refuses once the interviewer conversation exists, and leaves the row unchanged", async () => {
    const session = await aSession("fable");
    scriptInterviewer([aProposeRoundTurn()]);
    const turnResult = await requestNextRound.run({ sessionId: session.id });
    expect(turnResult.turnStatus).toBe("idle");
    expect((await readRow(session.id)).conversationId).not.toBeNull();

    await expect(
      setSessionModel.run({ sessionId: session.id, model: "opus" }),
    ).rejects.toMatchObject({
      errorCode: "model-locked",
      details: { recordedModel: "fable" },
    });

    expect((await readRow(session.id)).model).toBe("fable");
  });

  it("refuses while a turn is working, and leaves the row unchanged", async () => {
    const session = await aSession("fable");
    await getDb()
      .update(schema.sessions)
      .set({ turnStatus: "working" })
      .where(eq(schema.sessions.id, session.id));

    await expect(
      setSessionModel.run({ sessionId: session.id, model: "opus" }),
    ).rejects.toMatchObject({
      errorCode: "model-locked",
      details: { recordedModel: "fable" },
    });

    const row = await readRow(session.id);
    expect(row.model).toBe("fable");
    expect(row.turnStatus).toBe("working");
  });

  it("accepts a change after a turn failed without ever setting a conversation id", async () => {
    const session = await aSession("fable");
    await getDb()
      .update(schema.sessions)
      .set({ turnStatus: "failed", conversationId: null })
      .where(eq(schema.sessions.id, session.id));

    const updated = await setSessionModel.run({
      sessionId: session.id,
      model: "opus",
    });

    expect(updated.model).toBe("opus");
    expect((await readRow(session.id)).model).toBe("opus");
  });

  it("rejects a model outside the shared constants, and leaves the row unchanged", async () => {
    const session = await aSession("fable");

    await expect(
      setSessionModel.run({
        sessionId: session.id,
        model: "haiku" as unknown as "fable",
      }),
    ).rejects.toBeTruthy();

    expect((await readRow(session.id)).model).toBe("fable");
  });

  it("can be changed more than once before lock", async () => {
    const session = await aSession("fable");

    await setSessionModel.run({ sessionId: session.id, model: "opus" });
    const updated = await setSessionModel.run({
      sessionId: session.id,
      model: "sonnet",
    });

    expect(updated.model).toBe("sonnet");
    expect((await readRow(session.id)).model).toBe("sonnet");
  });

  it("selecting the model already recorded succeeds and leaves it unchanged", async () => {
    const session = await aSession("fable");

    const updated = await setSessionModel.run({
      sessionId: session.id,
      model: "fable",
    });

    expect(updated.model).toBe("fable");
    expect((await readRow(session.id)).model).toBe("fable");
  });
});
