import { eq } from "@agent-native/core/db/schema";
import { afterEach, describe, expect, it } from "vitest";

import createSession from "../actions/create-session.js";
import getCurrentRound from "../actions/get-current-round.js";
import reopenDecision from "../actions/reopen-decision.js";
import saveDraftAnswer from "../actions/save-draft-answer.js";
import submitRound from "../actions/submit-round.js";
import { getDb, schema, useTestDatabase } from "../test/db.js";
import {
  resetInterviewer,
  scriptInterviewer,
  type ScriptedTurn,
} from "./interviewer/index.js";

const DEFERRAL = "It waits on how long data is kept.";

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

function readDecision(id: string) {
  return getDb()
    .select()
    .from(schema.decisions)
    .where(eq(schema.decisions.id, id))
    .limit(1)
    .then((rows) => rows[0]);
}

const nothingMore: ScriptedTurn = {
  kind: "propose-round",
  result: {
    proposedDecisions: [],
    pushBackResponses: [],
    userDecisionPlacements: [],
    done: null,
  },
};

/**
 * shape, storage hanging off it, and backup: a settled own answer carrying
 * both a pending replacement naming storage and a pending deferral of its own.
 * storage carries a pending deferral too.
 */
async function aChainWithPendingProposals() {
  const session = await createSession.run({
    title: "Grill Room",
    idea: "A local app that grills me about an idea until it is decided.",
  });
  await insertDecision(session.id, {
    id: "d-shape",
    key: "shape",
    questionTitle: "What shape should this take?",
    answerKind: "own-answer",
    currentAnswer: "A workspace",
    settledAt: "2026-09-01T00:00:01.000Z",
  });
  await insertDecision(session.id, {
    id: "d-storage",
    key: "storage",
    questionTitle: "Where does the data live?",
    answerKind: "own-answer",
    currentAnswer: "On disk",
    dependsOnJson: JSON.stringify(["d-shape"]),
    settledAt: "2026-09-01T00:00:02.000Z",
    deferralReason: DEFERRAL,
  });
  await insertDecision(session.id, {
    id: "d-backup",
    key: "backup",
    questionTitle: "Is it backed up?",
    answerKind: "own-answer",
    currentAnswer: "Decide once retention is known",
    settledAt: "2026-09-01T00:00:00.000Z",
    supersededById: "d-storage",
    supersessionReason: "Storage changes how backups work.",
    deferralReason: DEFERRAL,
  });
  return session;
}

/** Reopens shape and answers it again, running the stale review that re-asks storage. */
async function reopenShapeAndReAskStorage(sessionId: string) {
  scriptInterviewer([
    {
      kind: "review-stale",
      result: {
        reviews: [
          {
            decisionKey: "storage",
            verdict: "re-ask",
            reason: "A page stores differently.",
            title: "Where does a page keep its data?",
            body: null,
            choices: [],
            recommendedChoice: null,
            recommendedAnswer: null,
          },
        ],
      },
    },
    nothingMore,
  ]);
  await reopenDecision.run({ decisionId: "d-shape" });
  const open = await getCurrentRound.run({ sessionId });
  await saveDraftAnswer.run({
    decisionId: "d-shape",
    answerKind: "own-answer",
    answer: "A page, after all",
  });
  await submitRound.run({ id: open.round!.id });
}

describe("a stale review that re-asks a decision", () => {
  useTestDatabase();
  afterEach(resetInterviewer);

  it("clears the re-asked decision's own pending deferral", async () => {
    const session = await aChainWithPendingProposals();

    await reopenShapeAndReAskStorage(session.id);

    expect(await readDecision("d-storage")).toMatchObject({
      answerKind: null,
      deferralReason: null,
    });
  });

  it("withdraws another decision's supersession that names it, and leaves that decision's own deferral pending", async () => {
    const session = await aChainWithPendingProposals();

    await reopenShapeAndReAskStorage(session.id);

    expect(await readDecision("d-backup")).toMatchObject({
      answerKind: "own-answer",
      supersededById: null,
      supersessionAnswer: null,
      supersessionReason: null,
      deferralReason: DEFERRAL,
    });
  });
});
