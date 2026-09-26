import { eq } from "@agent-native/core/db/schema";
import { afterEach, describe, expect, it } from "vitest";

import {
  resetInterviewer,
  scriptInterviewer,
  type ScriptedTurn,
} from "../server/interviewer/index.js";
import { CLEARED_PROPOSAL, CLEARED_SUPERSESSION } from "../server/tree.js";
import { getDb, schema, useTestDatabase } from "../test/db.js";
import acceptDeferral from "./accept-deferral.js";
import confirmSession from "./confirm-session.js";
import createSession from "./create-session.js";
import getTree from "./get-tree.js";
import listLooseEnds from "./list-loose-ends.js";
import requestNextRound from "./request-next-round.js";

const ANSWER = "Wait until dispute handling is settled";
const REASON =
  "The answer waits on dispute handling instead of choosing a hold period.";
const SETTLED_AT = "2026-09-01T00:00:01.000Z";

function aSession() {
  return createSession.run({
    title: "Grill Room",
    idea: "A marketplace for local services.",
  });
}

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

/** A done-proposed session whose one settled own answer carries a pending deferral. */
async function aPendingDeferral() {
  const session = await aSession();
  await insertDecision(session.id, {
    id: "d-hold",
    key: "hold",
    questionTitle: "How long is a payout held?",
    questionBody: "A hold protects against disputes.",
    answerKind: "own-answer",
    currentAnswer: ANSWER,
    settledAt: SETTLED_AT,
    deferralReason: REASON,
  });
  await getDb()
    .update(schema.sessions)
    .set({ state: "done-proposed", doneSummary: "Everything is settled." })
    .where(eq(schema.sessions.id, session.id));
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

function historyOf(decisionId: string) {
  return getDb()
    .select()
    .from(schema.decisionHistory)
    .where(eq(schema.decisionHistory.decisionId, decisionId));
}

const nothingNew: ScriptedTurn = {
  kind: "propose-round",
  result: {
    proposedDecisions: [],
    pushBackResponses: [],
    userDecisionPlacements: [],
    done: null,
  },
};

describe("accept-deferral", () => {
  useTestDatabase();
  afterEach(resetInterviewer);

  it("throws for a decision id that does not exist", async () => {
    await expect(acceptDeferral.run({ decisionId: "missing" })).rejects.toThrow(
      "Decision not found: missing",
    );
  });

  it("refuses a decision with no deferral pending, with no-deferral", async () => {
    const session = await aSession();
    await insertDecision(session.id, {
      id: "d-hold",
      key: "hold",
      questionTitle: "How long is a payout held?",
      answerKind: "own-answer",
      currentAnswer: "48 hours",
      settledAt: SETTLED_AT,
    });

    await expect(
      acceptDeferral.run({ decisionId: "d-hold" }),
    ).rejects.toMatchObject({ errorCode: "no-deferral", statusCode: 409 });
    expect(await readDecision("d-hold")).toMatchObject({
      answerKind: "own-answer",
      settledAt: SETTLED_AT,
    });
    expect(await historyOf("d-hold")).toEqual([]);
  });

  it("records the own answer in history, with the interviewer's reason", async () => {
    await aPendingDeferral();

    await acceptDeferral.run({ decisionId: "d-hold" });

    expect(await historyOf("d-hold")).toMatchObject([
      {
        answer: ANSWER,
        answerKind: "own-answer",
        interviewerReason: REASON,
        questionTitle: "How long is a payout held?",
        questionBody: "A hold protects against disputes.",
      },
    ]);
  });

  it("makes the decision a deferred loose end, so confirmation is refused", async () => {
    const session = await aPendingDeferral();

    const view = await acceptDeferral.run({ decisionId: "d-hold" });

    expect(view).toMatchObject({
      answer: { kind: "deferred", text: ANSWER },
      deferralReason: null,
      settledAt: null,
      state: "frontier",
    });
    expect(await readDecision("d-hold")).toMatchObject({
      answerKind: "deferred",
      currentAnswer: ANSWER,
      settledAt: null,
      deferralReason: null,
    });
    expect(await listLooseEnds.run({ sessionId: session.id })).toMatchObject([
      { key: "hold", reason: "deferred" },
    ]);
    await expect(
      confirmSession.run({ sessionId: session.id }),
    ).rejects.toMatchObject({ errorCode: "loose-ends-remain" });
  });

  it("asks it again as a new card at the next round request, with the own answer in its history", async () => {
    const session = await aPendingDeferral();
    await acceptDeferral.run({ decisionId: "d-hold" });
    scriptInterviewer([nothingNew]);

    const next = await requestNextRound.run({ sessionId: session.id });

    expect(next.state).toBe("interviewing");
    expect(next.round?.decisions).toMatchObject([
      { key: "hold", answer: null },
    ]);
    const tree = await getTree.run({ sessionId: session.id });
    const hold = tree.decisions.find((decision) => decision.key === "hold");
    expect(hold?.answer).toBeNull();
    expect(hold?.previousAnswers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          text: ANSWER,
          kind: "own-answer",
          interviewerReason: REASON,
        }),
      ]),
    );
  });

  it("adds no staleness: a settled dependent stays settled, an unanswered one is blocked", async () => {
    const session = await aPendingDeferral();
    await insertDecision(session.id, {
      id: "d-release",
      key: "release",
      questionTitle: "Who releases a held payout?",
      dependsOnJson: JSON.stringify(["d-hold"]),
      answerKind: "own-answer",
      currentAnswer: "Automatically, when the hold ends.",
      settledAt: "2026-09-01T00:00:02.000Z",
    });
    await insertDecision(session.id, {
      id: "d-notice",
      key: "notice",
      questionTitle: "How is the seller told?",
      dependsOnJson: JSON.stringify(["d-hold"]),
    });

    await acceptDeferral.run({ decisionId: "d-hold" });

    const tree = await getTree.run({ sessionId: session.id });
    expect(
      Object.fromEntries(tree.decisions.map((d) => [d.key, d.state])),
    ).toEqual({ hold: "frontier", release: "settled", notice: "blocked" });
  });
});

describe("the proposal a changed answer clears", () => {
  it("CLEARED_PROPOSAL clears the deferral beside the supersession; CLEARED_SUPERSESSION does not", () => {
    expect(CLEARED_PROPOSAL).toEqual({
      supersededById: null,
      supersessionAnswer: null,
      supersessionReason: null,
      deferralReason: null,
    });
    expect(CLEARED_SUPERSESSION).toEqual({
      supersededById: null,
      supersessionAnswer: null,
      supersessionReason: null,
    });
  });
});
