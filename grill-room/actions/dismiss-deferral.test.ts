import { eq } from "@agent-native/core/db/schema";
import { describe, expect, it } from "vitest";

import { getDb, schema, useTestDatabase } from "../test/db.js";
import createSession from "./create-session.js";
import dismissDeferral from "./dismiss-deferral.js";
import listLooseEnds from "./list-loose-ends.js";

const SETTLED_AT = "2026-09-01T00:00:01.000Z";

async function aSettledOwnAnswer(deferralReason: string | null) {
  const session = await createSession.run({
    title: "Grill Room",
    idea: "A marketplace for local services.",
  });
  const now = new Date().toISOString();
  await getDb()
    .insert(schema.decisions)
    .values({
      id: "d-hold",
      sessionId: session.id,
      key: "hold",
      questionTitle: "How long is a payout held?",
      questionBody: "",
      offeredChoicesJson: "[]",
      dependsOnJson: "[]",
      introducedBy: "interviewer",
      answerKind: "own-answer",
      currentAnswer: "48 hours; revisit after launch",
      settledAt: SETTLED_AT,
      deferralReason,
      createdAt: now,
      updatedAt: now,
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

describe("dismiss-deferral", () => {
  useTestDatabase();

  it("throws for a decision id that does not exist", async () => {
    await expect(dismissDeferral.run({ decisionId: "missing" })).rejects.toThrow(
      "Decision not found: missing",
    );
  });

  it("refuses a decision with no deferral pending, with no-deferral", async () => {
    await aSettledOwnAnswer(null);

    await expect(
      dismissDeferral.run({ decisionId: "d-hold" }),
    ).rejects.toMatchObject({ errorCode: "no-deferral", statusCode: 409 });
  });

  it("clears the proposal and leaves the decision settled, recording nothing in history", async () => {
    const session = await aSettledOwnAnswer("It reads as waiting on launch.");

    const view = await dismissDeferral.run({ decisionId: "d-hold" });

    expect(view).toMatchObject({
      state: "settled",
      answer: { kind: "own-answer", text: "48 hours; revisit after launch" },
      deferralReason: null,
    });
    expect(await readDecision("d-hold")).toMatchObject({
      answerKind: "own-answer",
      currentAnswer: "48 hours; revisit after launch",
      settledAt: SETTLED_AT,
      deferralReason: null,
    });
    expect(
      await getDb()
        .select()
        .from(schema.decisionHistory)
        .where(eq(schema.decisionHistory.decisionId, "d-hold")),
    ).toEqual([]);
    expect(await listLooseEnds.run({ sessionId: session.id })).toEqual([]);
  });
});
