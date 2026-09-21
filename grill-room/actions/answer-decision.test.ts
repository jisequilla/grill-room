import { eq } from "@agent-native/core/db/schema";
import { describe, expect, it } from "vitest";

import type { DecisionAnswerKind } from "../server/db/schema.js";
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
    "settles a %s loose end with an own answer and keeps its history",
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

      const history = await getDb()
        .select()
        .from(schema.decisionHistory)
        .where(eq(schema.decisionHistory.decisionId, "decision-1"));
      expect(history).toMatchObject([{ answerKind }]);

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
});
