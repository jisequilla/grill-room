import { eq } from "@agent-native/core/db/schema";
import { describe, expect, it } from "vitest";

import { getDb, schema, useTestDatabase } from "../test/db.js";
import createSession from "./create-session.js";
import dismissRestatement from "./dismiss-restatement.js";
import listLooseEnds from "./list-loose-ends.js";

const ORIGINAL = "Stirpe. Claude, double-check the fee table.";
const SETTLED_AT = "2026-09-01T00:00:01.000Z";

async function aSettledOwnAnswer(
  overrides: Partial<typeof schema.decisions.$inferInsert> = {},
) {
  const session = await createSession.run({
    title: "Grill Room",
    idea: "A marketplace for local services.",
  });
  const now = new Date().toISOString();
  await getDb()
    .insert(schema.decisions)
    .values({
      id: "d-provider",
      sessionId: session.id,
      key: "provider",
      questionTitle: "Which payment provider handles payouts?",
      questionBody: "",
      offeredChoicesJson: "[]",
      dependsOnJson: "[]",
      introducedBy: "interviewer",
      answerKind: "own-answer",
      currentAnswer: ORIGINAL,
      settledAt: SETTLED_AT,
      restatementText: "Stripe.",
      restatementNotes: "Claude, double-check the fee table.",
      restatementReason: "Took out a note to the AI.",
      createdAt: now,
      updatedAt: now,
      ...overrides,
    });
  return session;
}

function readDecision(id: string) {
  return getDb()
    .select()
    .from(schema.decisions)
    .where(eq(schema.decisions.id, id))
    .limit(1)
    .then((rows) => rows[0]);
}

describe("dismiss-restatement", () => {
  useTestDatabase();

  it("throws for a decision id that does not exist", async () => {
    await expect(
      dismissRestatement.run({ decisionId: "missing" }),
    ).rejects.toThrow("Decision not found: missing");
  });

  it("refuses a decision with no restatement pending, with no-restatement", async () => {
    await aSettledOwnAnswer({
      restatementText: null,
      restatementNotes: null,
      restatementReason: null,
    });

    await expect(
      dismissRestatement.run({ decisionId: "d-provider" }),
    ).rejects.toMatchObject({ errorCode: "no-restatement", statusCode: 409 });
  });

  it("clears only the three restatement columns, leaving the answer as written and recording nothing in history", async () => {
    const session = await aSettledOwnAnswer();
    const before = await readDecision("d-provider");

    const view = await dismissRestatement.run({ decisionId: "d-provider" });

    const after = await readDecision("d-provider");
    const { updatedAt: _before, ...restBefore } = before!;
    const { updatedAt: _after, ...restAfter } = after!;
    expect(restAfter).toEqual({
      ...restBefore,
      restatementText: null,
      restatementNotes: null,
      restatementReason: null,
    });
    expect(view).toMatchObject({
      state: "settled",
      answer: { kind: "own-answer", text: ORIGINAL },
      restatementText: null,
    });
    expect(
      await getDb()
        .select()
        .from(schema.decisionHistory)
        .where(eq(schema.decisionHistory.decisionId, "d-provider")),
    ).toEqual([]);
    expect(await listLooseEnds.run({ sessionId: session.id })).toEqual([]);
  });
});
