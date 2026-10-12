import { eq } from "@agent-native/core/db/schema";
import { describe, expect, it } from "vitest";

import type { DecisionAnswerKind } from "../server/db/schema.js";
import { describeDecisions } from "../server/tree.js";
import { getDb, schema, useTestDatabase } from "../test/db.js";
import answerDecision from "./answer-decision.js";
import createSession from "./create-session.js";
import getTree from "./get-tree.js";

function aSession() {
  return createSession.run({
    title: "Grill Room",
    idea: "A local app that grills me about an idea until it is decided.",
  });
}

/** A decision arranged directly in the state under test, no round required. */
async function arrangeDecision(
  sessionId: string,
  decision: {
    id: string;
    key: string;
    answerKind?: DecisionAnswerKind | null;
    answer?: string | null;
    withdrawnAt?: string | null;
  },
) {
  const now = new Date().toISOString();
  await getDb()
    .insert(schema.decisions)
    .values({
      id: decision.id,
      sessionId,
      key: decision.key,
      questionTitle: `Question ${decision.key}`,
      dependsOnJson: "[]",
      answerKind: decision.answerKind ?? null,
      currentAnswer: decision.answer ?? null,
      withdrawnAt: decision.withdrawnAt ?? null,
      createdAt: now,
      updatedAt: now,
    });
}

describe("answer-decision", () => {
  useTestDatabase();

  it("throws for a decision id that does not exist", async () => {
    await expect(
      answerDecision.run({ decisionId: "missing", answer: "Something" }),
    ).rejects.toThrow("Decision not found: missing");
  });

  it.each(["unknown", "deferred", "prototype-flagged", "pushed-back"] as const)(
    "settles a %s loose end with an own answer",
    async (answerKind) => {
      const session = await aSession();
      await arrangeDecision(session.id, {
        id: "decision-1",
        key: "shape",
        answerKind,
        answer: answerKind === "pushed-back" ? "Too vague." : "",
      });

      const result = await answerDecision.run({
        decisionId: "decision-1",
        answer: "A workspace, now that the prototype settled it.",
      });

      expect(result).toMatchObject({
        answer: {
          kind: "own-answer",
          text: "A workspace, now that the prototype settled it.",
        },
        state: "settled",
      });
      expect(result.settledAt).toEqual(expect.stringMatching(/^\d{4}-/));

      const tree = await getTree.run({ sessionId: session.id });
      expect(tree.decisions).toMatchObject([
        { key: "shape", state: "settled" },
      ]);
    },
  );

  it("refuses a decision that was never a loose end", async () => {
    const session = await aSession();
    await arrangeDecision(session.id, {
      id: "decision-1",
      key: "shape",
      answerKind: null,
    });

    await expect(
      answerDecision.run({ decisionId: "decision-1", answer: "A workspace" }),
    ).rejects.toThrow(/not an unresolved loose end/);
  });

  it("refuses a decision already settled", async () => {
    const session = await aSession();
    await arrangeDecision(session.id, {
      id: "decision-1",
      key: "shape",
      answerKind: "own-answer",
      answer: "A workspace",
    });

    await expect(
      answerDecision.run({ decisionId: "decision-1", answer: "Something else" }),
    ).rejects.toThrow(/not an unresolved loose end/);
  });

  it("refuses a push back the interviewer has already responded to", async () => {
    const session = await aSession();
    await arrangeDecision(session.id, {
      id: "decision-1",
      key: "shape",
      answerKind: "pushed-back",
      answer: "Too vague.",
      withdrawnAt: new Date().toISOString(),
    });

    await expect(
      answerDecision.run({ decisionId: "decision-1", answer: "A workspace" }),
    ).rejects.toThrow(/not an unresolved loose end/);
  });

  it("refuses an empty answer", async () => {
    const session = await aSession();
    await arrangeDecision(session.id, {
      id: "decision-1",
      key: "shape",
      answerKind: "unknown",
    });

    await expect(
      answerDecision.run({ decisionId: "decision-1", answer: "   " }),
    ).rejects.toThrow(/answer needs some text/);
  });

  it("refuses while the interviewer is working, writing nothing", async () => {
    const session = await aSession();
    await arrangeDecision(session.id, {
      id: "decision-1",
      key: "shape",
      answerKind: "deferred",
      answer: "Later",
    });
    await getDb()
      .update(schema.sessions)
      .set({ turnStatus: "working", turnStartedAt: new Date().toISOString() })
      .where(eq(schema.sessions.id, session.id));
    const [before] = await getDb()
      .select()
      .from(schema.decisions)
      .where(eq(schema.decisions.id, "decision-1"));

    const refusal = answerDecision.run({ decisionId: "decision-1", answer: "A workspace" });

    await expect(refusal).rejects.toMatchObject({
      errorCode: "turn-in-progress",
      statusCode: 409,
    });
    await expect(refusal).rejects.toThrow(
      "The interviewer is working on this session. Wait for the turn to finish before answering a decision.",
    );
    expect(
      await getDb()
        .select()
        .from(schema.decisionHistory)
        .where(eq(schema.decisionHistory.decisionId, "decision-1")),
    ).toEqual([]);
    const [after] = await getDb()
      .select()
      .from(schema.decisions)
      .where(eq(schema.decisions.id, "decision-1"));
    expect(after).toEqual(before);
  });

  it("applies the answer change rule", async () => {
    const session = await aSession();
    await getDb()
      .update(schema.sessions)
      .set({ state: "done-proposed", doneSummary: "Nothing left." })
      .where(eq(schema.sessions.id, session.id));
    const now = new Date().toISOString();
    await getDb().insert(schema.specs).values({
      id: "spec-1",
      sessionId: session.id,
      markdown: "# Grill Room\n",
      current: true,
      createdAt: now,
      updatedAt: now,
    });
    await arrangeDecision(session.id, {
      id: "decision-x",
      key: "x",
      answerKind: "deferred",
      answer: "Later",
    });
    await arrangeDecision(session.id, { id: "decision-y", key: "y" });
    await arrangeDecision(session.id, { id: "decision-z", key: "z" });
    await getDb()
      .update(schema.decisions)
      .set({
        supersededById: "decision-x",
        supersessionAnswer: "Answered by x",
        supersessionReason: "x covers it",
      })
      .where(eq(schema.decisions.id, "decision-y"));
    await getDb()
      .update(schema.decisions)
      .set({ replacedById: "decision-x", replacedReason: "x replaced it" })
      .where(eq(schema.decisions.id, "decision-z"));

    const result = await answerDecision.run({
      decisionId: "decision-x",
      answer: "A workspace.",
    });

    const rows = await getDb().select().from(schema.decisions);
    const byId = (id: string) => rows.find((decision) => decision.id === id)!;
    expect(byId("decision-y")).toMatchObject({
      supersededById: null,
      supersessionAnswer: null,
      supersessionReason: null,
    });
    expect(byId("decision-z")).toMatchObject({ replacedById: null, replacedReason: null });
    const [spec] = await getDb()
      .select()
      .from(schema.specs)
      .where(eq(schema.specs.sessionId, session.id));
    expect(spec).toMatchObject({ current: false });
    expect(result).toEqual(describeDecisions([byId("decision-x")])[0]);
  });
});
