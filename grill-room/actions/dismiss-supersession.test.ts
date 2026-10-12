import { eq } from "@agent-native/core/db/schema";
import { describe, expect, it } from "vitest";

import { getDb, schema, useTestDatabase } from "../test/db.js";
import createSession from "./create-session.js";
import dismissSupersession from "./dismiss-supersession.js";

/**
 * Two settled decisions, the first carrying a pending replacement by the
 * second, which settled later.
 */
async function aPendingReplacement() {
  const session = await createSession.run({
    title: "Grill Room",
    idea: "A local app that grills me about an idea until it is decided.",
  });
  const now = new Date().toISOString();
  const decision = {
    sessionId: session.id,
    questionBody: "",
    offeredChoicesJson: "[]",
    dependsOnJson: "[]",
    introducedBy: "interviewer" as const,
    createdAt: now,
    updatedAt: now,
  };
  // The replacing decision goes in first: the proposal column references it.
  await getDb().insert(schema.decisions).values({
    ...decision,
    id: "d-location",
    key: "storage-location",
    questionTitle: "Which disk does the data live on?",
    answerKind: "own-answer",
    currentAnswer: "A synced cloud folder",
    settledAt: "2026-09-01T00:00:02.000Z",
  });
  await getDb().insert(schema.decisions).values({
    ...decision,
    id: "d-storage",
    key: "storage",
    questionTitle: "Where does the data live?",
    answerKind: "own-answer",
    currentAnswer: "On disk",
    settledAt: "2026-09-01T00:00:01.000Z",
    supersededById: "d-location",
    supersessionReason: "Storage moved into a synced cloud folder.",
    proposalKind: "replacement",
  });
}

function readDecision(id: string) {
  return getDb()
    .select()
    .from(schema.decisions)
    .where(eq(schema.decisions.id, id))
    .limit(1)
    .then((rows) => rows[0]);
}

describe("dismiss-supersession", () => {
  useTestDatabase();

  it("K3: dismissing a replacement clears the proposal and its kind", async () => {
    await aPendingReplacement();

    await dismissSupersession.run({ decisionId: "d-storage" });

    expect(await readDecision("d-storage")).toMatchObject({
      supersededById: null,
      supersessionAnswer: null,
      supersessionReason: null,
      proposalKind: null,
      currentAnswer: "On disk",
      replacedById: null,
    });
  });
});
