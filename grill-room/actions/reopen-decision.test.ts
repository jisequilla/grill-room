import { eq } from "@agent-native/core/db/schema";
import { afterEach, describe, expect, it } from "vitest";

import {
  resetInterviewer,
  scriptInterviewer,
  type FakeInterviewer,
  type ScriptedTurn,
} from "../server/interviewer/index.js";
import { getDb, schema, useTestDatabase } from "../test/db.js";
import createSession from "./create-session.js";
import getCurrentRound from "./get-current-round.js";
import getSession from "./get-session.js";
import getTree from "./get-tree.js";
import reopenDecision from "./reopen-decision.js";
import requestNextRound from "./request-next-round.js";
import saveDraftAnswer from "./save-draft-answer.js";
import submitRound from "./submit-round.js";

/** One round proposing one question, which is all these tests need per turn. */
function proposal(key: string, dependsOn: string[] = []): ScriptedTurn {
  return {
    kind: "propose-round",
    result: {
      proposedDecisions: [
        {
          key,
          title: `Question ${key}`,
          body: `The body of ${key}`,
          choices: [],
          recommendedAnswer: `The usual answer to ${key}`,
          dependsOn,
          ask: true,
        },
      ],
      pushBackResponses: [],
      userDecisionPlacements: [],
      done: null,
    },
  };
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

function aSession() {
  return createSession.run({
    title: "Grill Room",
    idea: "A local app that grills me about an idea until it is decided.",
  });
}

/** Answers whatever the open round asks, and submits it. */
async function answerOpenRound(sessionId: string, answer: string) {
  const open = await getCurrentRound.run({ sessionId });
  for (const card of open.round?.decisions ?? []) {
    await saveDraftAnswer.run({
      decisionId: card.id,
      answerKind: "own-answer",
      answer,
    });
  }
  return submitRound.run({ id: open.round!.id });
}

/**
 * A session whose chain shape -> storage -> sync is settled, each answered in
 * its own round. `trailing` is what the interviewer says after the last one.
 */
async function aSettledChain(trailing: ScriptedTurn = nothingMore): Promise<{
  sessionId: string;
  interviewer: FakeInterviewer;
}> {
  const session = await aSession();
  const interviewer = scriptInterviewer([
    proposal("shape"),
    proposal("storage", ["shape"]),
    proposal("sync", ["storage"]),
    trailing,
  ]);

  await requestNextRound.run({ sessionId: session.id });
  await answerOpenRound(session.id, "A workspace");
  await answerOpenRound(session.id, "On disk");
  await answerOpenRound(session.id, "Poll");

  return { sessionId: session.id, interviewer };
}

async function statesOf(sessionId: string) {
  const tree = await getTree.run({ sessionId });
  return Object.fromEntries(
    tree.decisions.map((decision) => [decision.key, decision.state]),
  );
}

async function decisionId(sessionId: string, key: string) {
  const tree = await getTree.run({ sessionId });
  return tree.decisions.find((decision) => decision.key === key)!.id;
}

describe("reopen-decision", () => {
  useTestDatabase();
  afterEach(resetInterviewer);

  it("throws for a decision id that does not exist", async () => {
    await expect(
      reopenDecision.run({ decisionId: "missing" }),
    ).rejects.toThrow("Decision not found: missing");
  });

  it("puts a settled decision back on the frontier and everything under it in doubt", async () => {
    const { sessionId } = await aSettledChain();

    await reopenDecision.run({
      decisionId: await decisionId(sessionId, "shape"),
    });

    expect(await statesOf(sessionId)).toEqual({
      shape: "frontier",
      storage: "stale",
      sync: "stale",
    });
  });

  it("keeps the answer it cleared as history", async () => {
    const { sessionId } = await aSettledChain();

    await reopenDecision.run({
      decisionId: await decisionId(sessionId, "shape"),
    });

    const tree = await getTree.run({ sessionId });
    const shape = tree.decisions.find((decision) => decision.key === "shape");

    expect(shape?.answer).toBeNull();
    expect(shape?.settledAt).toBeNull();
    expect(shape?.previousAnswers).toEqual([
      {
        text: "A workspace",
        kind: "own-answer",
        // The user reopened it; the interviewer had nothing to say about that.
        interviewerReason: null,
        recordedAt: expect.stringMatching(/^\d{4}-/),
      },
    ]);
  });

  it("asks the question again as a round of its own, without troubling the interviewer", async () => {
    const { sessionId, interviewer } = await aSettledChain();
    const before = interviewer.requests.length;

    const result = await reopenDecision.run({
      decisionId: await decisionId(sessionId, "shape"),
    });

    expect(result.round?.decisions.map((card) => card.key)).toEqual(["shape"]);
    expect(result.round?.decisions[0]).toMatchObject({
      questionTitle: "Question shape",
      state: "frontier",
      draft: null,
    });
    expect(interviewer.requests).toHaveLength(before);
  });

  it("appends the question to the round already open instead of opening another", async () => {
    // The interviewer's last word opens a round that is still unanswered.
    const { sessionId, interviewer } = await aSettledChain(proposal("tone"));
    const before = interviewer.requests.length;

    const result = await reopenDecision.run({
      decisionId: await decisionId(sessionId, "shape"),
    });

    expect(result.round?.decisions.map((card) => card.key)).toEqual([
      "tone",
      "shape",
    ]);
    expect(interviewer.requests).toHaveLength(before);
    expect(
      await getDb()
        .select()
        .from(schema.rounds)
        .where(eq(schema.rounds.sessionId, sessionId)),
    ).toHaveLength(4);
  });

  it("returns a session that had proposed done to interviewing", async () => {
    const { sessionId } = await aSettledChain();
    await getDb()
      .update(schema.sessions)
      .set({ state: "done-proposed" })
      .where(eq(schema.sessions.id, sessionId));

    await reopenDecision.run({
      decisionId: await decisionId(sessionId, "shape"),
    });

    expect(await getSession.run({ id: sessionId })).toMatchObject({
      state: "interviewing",
    });
  });

  it("returns a confirmed session to interviewing, so a late realisation is not locked out", async () => {
    const { sessionId } = await aSettledChain();
    await getDb()
      .update(schema.sessions)
      .set({ state: "confirmed" })
      .where(eq(schema.sessions.id, sessionId));

    await reopenDecision.run({
      decisionId: await decisionId(sessionId, "sync"),
    });

    expect(await getSession.run({ id: sessionId })).toMatchObject({
      state: "interviewing",
    });
  });

  it("refuses a decision that was never settled", async () => {
    const session = await aSession();
    scriptInterviewer([proposal("shape")]);
    const opened = await requestNextRound.run({ sessionId: session.id });

    await expect(
      reopenDecision.run({ decisionId: opened.round!.decisions[0]!.id }),
    ).rejects.toThrow(/Only a decision that has been settled can be reopened/);
  });

  it("refuses while the interviewer is working", async () => {
    const { sessionId } = await aSettledChain();
    await getDb()
      .update(schema.sessions)
      .set({ turnStatus: "working", turnStartedAt: new Date().toISOString() })
      .where(eq(schema.sessions.id, sessionId));

    await expect(
      reopenDecision.run({
        decisionId: await decisionId(sessionId, "shape"),
      }),
    ).rejects.toThrow(/interviewer is working/);
  });
});
