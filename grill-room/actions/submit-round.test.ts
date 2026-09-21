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
import listRounds from "./list-rounds.js";
import reopenDecision from "./reopen-decision.js";
import requestNextRound from "./request-next-round.js";
import saveDraftAnswer from "./save-draft-answer.js";
import submitRound from "./submit-round.js";

/*
 * Answering a round runs through three actions, and they are tested together
 * here. The harness builds one database per test file, and the suite already
 * runs more files than this machine has cores: past that point the per-file
 * build outruns vitest's hook timeout and unrelated files start failing.
 */

function proposal(
  ...proposedDecisions: {
    key: string;
    title: string;
    recommendedAnswer?: string;
    choices?: string[];
    dependsOn?: string[];
    ask?: boolean;
  }[]
): ScriptedTurn {
  return {
    kind: "propose-round",
    result: {
      proposedDecisions: proposedDecisions.map((decision) => ({
        key: decision.key,
        title: decision.title,
        body: "",
        choices: decision.choices ?? [],
        recommendedAnswer:
          decision.recommendedAnswer ?? `The usual answer to ${decision.key}`,
        dependsOn: decision.dependsOn ?? [],
        ask: decision.ask ?? true,
      })),
      pushBackResponses: [],
      userDecisionPlacements: [],
      done: null,
    },
  };
}

function aSession() {
  return createSession.run({
    title: "Grill Room",
    idea: "A local app that grills me about an idea until it is decided.",
  });
}

/** A session whose first round is open, with the given turns queued. */
async function aSessionMidRound(...turns: ScriptedTurn[]) {
  const session = await aSession();
  scriptInterviewer(turns);
  const opened = await requestNextRound.run({ sessionId: session.id });
  return { session, round: opened.round! };
}

const twoCards = proposal(
  {
    key: "shape",
    title: "What shape should this take?",
    recommendedAnswer: "A workspace",
    choices: ["A page", "A workspace"],
  },
  { key: "tone", title: "How blunt?", recommendedAnswer: "Blunt" },
);

describe("save-draft-answer", () => {
  useTestDatabase();
  afterEach(resetInterviewer);

  it("refuses a decision that is not a card of an open round", async () => {
    await expect(
      saveDraftAnswer.run({
        decisionId: "missing",
        answerKind: "own-answer",
        answer: "Anything",
      }),
    ).rejects.toThrow(/not a card of an open round/);
  });

  it("defaults an accepted recommendation to the recommended answer", async () => {
    const { round } = await aSessionMidRound(twoCards);

    const saved = await saveDraftAnswer.run({
      decisionId: round.decisions[0]!.id,
      answerKind: "accepted-recommendation",
    });

    expect(saved.draft).toEqual({
      answer: "A workspace",
      answerKind: "accepted-recommendation",
    });
  });

  it("refuses an own answer with no text", async () => {
    const { round } = await aSessionMidRound(twoCards);

    await expect(
      saveDraftAnswer.run({
        decisionId: round.decisions[0]!.id,
        answerKind: "own-answer",
        answer: "   ",
      }),
    ).rejects.toThrow(/own answer needs some text/);
  });

  it("refuses a push back with no reason", async () => {
    const { round } = await aSessionMidRound(twoCards);

    await expect(
      saveDraftAnswer.run({
        decisionId: round.decisions[0]!.id,
        answerKind: "pushed-back",
      }),
    ).rejects.toThrow(/push back needs a reason/);
  });

  it("accepts unknown and deferred with no text, and a pushed-back reason", async () => {
    const { round } = await aSessionMidRound(twoCards);

    const unknown = await saveDraftAnswer.run({
      decisionId: round.decisions[0]!.id,
      answerKind: "unknown",
    });
    expect(unknown.draft).toEqual({ answer: "", answerKind: "unknown" });

    const pushedBack = await saveDraftAnswer.run({
      decisionId: round.decisions[1]!.id,
      answerKind: "pushed-back",
      answer: "This is the wrong level of detail.",
    });
    expect(pushedBack.draft).toEqual({
      answer: "This is the wrong level of detail.",
      answerKind: "pushed-back",
    });
  });

  it("keeps drafts per card so a half-answered round survives a reload", async () => {
    const { session, round } = await aSessionMidRound(twoCards);

    await saveDraftAnswer.run({
      decisionId: round.decisions[0]!.id,
      answerKind: "own-answer",
      answer: "A workspace beside the tree",
    });

    const reloaded = await getCurrentRound.run({ sessionId: session.id });

    expect(
      reloaded.round?.decisions.map((card) => [card.key, card.draft]),
    ).toEqual([
      [
        "shape",
        { answer: "A workspace beside the tree", answerKind: "own-answer" },
      ],
      ["tone", null],
    ]);
  });

  it("replaces a draft when the same card is answered again", async () => {
    const { session, round } = await aSessionMidRound(twoCards);

    await saveDraftAnswer.run({
      decisionId: round.decisions[0]!.id,
      answerKind: "own-answer",
      answer: "First thought",
    });
    await saveDraftAnswer.run({
      decisionId: round.decisions[0]!.id,
      answerKind: "accepted-recommendation",
    });

    expect(
      (await getCurrentRound.run({ sessionId: session.id })).round
        ?.decisions[0]?.draft,
    ).toEqual({
      answer: "A workspace",
      answerKind: "accepted-recommendation",
    });
  });
});

describe("submit-round", () => {
  useTestDatabase();
  afterEach(resetInterviewer);

  it("throws for a round id that does not exist", async () => {
    await expect(submitRound.run({ id: "missing" })).rejects.toThrow(
      "Round not found: missing",
    );
  });

  it("refuses a round that still has unanswered cards", async () => {
    const { round } = await aSessionMidRound(twoCards);

    await saveDraftAnswer.run({
      decisionId: round.decisions[0]!.id,
      answerKind: "accepted-recommendation",
    });

    await expect(submitRound.run({ id: round.id })).rejects.toThrow(
      /Answer every card before submitting the round. Still open: How blunt\?/,
    );
  });

  it("turns every draft into a settled answer and asks for the next round", async () => {
    const { session, round } = await aSessionMidRound(
      twoCards,
      proposal({
        key: "storage",
        title: "Where does the data live?",
        dependsOn: ["shape"],
      }),
    );

    await saveDraftAnswer.run({
      decisionId: round.decisions[0]!.id,
      answerKind: "accepted-recommendation",
    });
    await saveDraftAnswer.run({
      decisionId: round.decisions[1]!.id,
      answerKind: "own-answer",
      answer: "Blunt, but not rude",
    });

    const next = await submitRound.run({ id: round.id });
    const tree = await getTree.run({ sessionId: session.id });

    expect(
      tree.decisions.map((decision) => [
        decision.key,
        decision.state,
        decision.answer,
      ]),
    ).toEqual([
      [
        "shape",
        "settled",
        { text: "A workspace", kind: "accepted-recommendation" },
      ],
      ["tone", "settled", { text: "Blunt, but not rude", kind: "own-answer" }],
      ["storage", "frontier", null],
    ]);
    expect(tree.decisions[0]?.settledAt).toEqual(
      expect.stringMatching(/^\d{4}-/),
    );
    expect(next.round?.decisions.map((card) => card.key)).toEqual(["storage"]);
  });

  it("does not settle a steering move, and keeps its dependents blocked", async () => {
    const { session, round } = await aSessionMidRound(
      proposal(
        { key: "shape", title: "What shape?" },
        {
          key: "storage",
          title: "Where does the data live?",
          dependsOn: ["shape"],
          ask: false,
        },
      ),
      // Nothing new to propose: "shape" is not settled, so "storage" is not
      // on the frontier yet and the interviewer has nothing it can ask.
      proposal(),
    );

    await saveDraftAnswer.run({
      decisionId: round.decisions[0]!.id,
      answerKind: "unknown",
    });
    const next = await submitRound.run({ id: round.id });

    expect(next.round).toBeNull();
    const tree = await getTree.run({ sessionId: session.id });
    expect(
      tree.decisions.map((decision) => [
        decision.key,
        decision.state,
        decision.answer,
      ]),
    ).toEqual([
      ["shape", "frontier", { text: "", kind: "unknown" }],
      ["storage", "blocked", null],
    ]);
    expect(tree.decisions[0]?.settledAt).toBeNull();
  });

  it("brings a deferred decision back once nothing else is pending, recording its deferral to history first", async () => {
    const { session, round } = await aSessionMidRound(
      proposal({ key: "shape", title: "What shape?" }),
      proposal(),
    );

    await saveDraftAnswer.run({
      decisionId: round.decisions[0]!.id,
      answerKind: "deferred",
    });
    const next = await submitRound.run({ id: round.id });

    // The deferred card is back, unanswered, as though asked for the first time.
    expect(next.round?.decisions.map((card) => card.key)).toEqual(["shape"]);
    expect(next.round?.decisions[0]?.answer).toBeNull();
    expect(next.round?.decisions[0]?.draft).toBeNull();

    const history = await getDb()
      .select()
      .from(schema.decisionHistory)
      .where(eq(schema.decisionHistory.decisionId, round.decisions[0]!.id));
    expect(history).toMatchObject([{ answerKind: "deferred", answer: "" }]);

    const tree = await getTree.run({ sessionId: session.id });
    expect(tree.decisions.map((decision) => [decision.key, decision.state])).toEqual(
      [["shape", "frontier"]],
    );
  });

  it("refuses a round that has already been submitted", async () => {
    const { round } = await aSessionMidRound(
      proposal({ key: "shape", title: "What shape?" }),
      proposal({
        key: "storage",
        title: "Where does the data live?",
        dependsOn: ["shape"],
      }),
    );

    await saveDraftAnswer.run({
      decisionId: round.decisions[0]!.id,
      answerKind: "accepted-recommendation",
    });
    await submitRound.run({ id: round.id });

    await expect(submitRound.run({ id: round.id })).rejects.toThrow(
      /already been submitted/,
    );
  });

  it("leaves the session without an open round when the interviewer proposes nothing more", async () => {
    const { session, round } = await aSessionMidRound(
      proposal({ key: "shape", title: "What shape?" }),
      proposal(),
    );

    await saveDraftAnswer.run({
      decisionId: round.decisions[0]!.id,
      answerKind: "accepted-recommendation",
    });

    const next = await submitRound.run({ id: round.id });

    expect(next.round).toBeNull();
    expect(next.turnStatus).toBe("idle");
    expect(
      (await getTree.run({ sessionId: session.id })).decisions,
    ).toHaveLength(1);
  });

  it("pulls a decision that was blocked into the round once it unblocks, alongside a newly proposed one", async () => {
    const { session, round } = await aSessionMidRound(
      proposal(
        { key: "shape", title: "What shape?" },
        {
          key: "storage",
          title: "Where does the data live?",
          dependsOn: ["shape"],
          ask: false,
        },
      ),
      proposal({
        key: "tone",
        title: "How blunt?",
        dependsOn: ["shape"],
      }),
    );

    expect(round.decisions.map((card) => card.key)).toEqual(["shape"]);

    await saveDraftAnswer.run({
      decisionId: round.decisions[0]!.id,
      answerKind: "accepted-recommendation",
    });
    const next = await submitRound.run({ id: round.id });

    // storage predates tone in the tree, so it leads the round even though
    // tone is what the fresh proposal actually contributed.
    expect(next.round?.decisions.map((card) => card.key)).toEqual([
      "storage",
      "tone",
    ]);
    expect(
      (await getTree.run({ sessionId: session.id })).decisions,
    ).toHaveLength(3);
  });

  it("still opens the round on the newly-unblocked decision when the next proposal adds nothing", async () => {
    const { round } = await aSessionMidRound(
      proposal(
        { key: "shape", title: "What shape?" },
        {
          key: "storage",
          title: "Where does the data live?",
          dependsOn: ["shape"],
          ask: false,
        },
      ),
      proposal(),
    );

    await saveDraftAnswer.run({
      decisionId: round.decisions[0]!.id,
      answerKind: "accepted-recommendation",
    });
    const next = await submitRound.run({ id: round.id });

    expect(next.round?.decisions.map((card) => card.key)).toEqual(["storage"]);
  });

  it("keeps a decision blocked on the newly-unblocked one out of the round", async () => {
    const { session, round } = await aSessionMidRound(
      proposal(
        { key: "shape", title: "What shape?" },
        {
          key: "storage",
          title: "Where does the data live?",
          dependsOn: ["shape"],
          ask: false,
        },
      ),
      proposal({
        key: "sync",
        title: "How does it sync?",
        dependsOn: ["storage"],
        ask: false,
      }),
    );

    await saveDraftAnswer.run({
      decisionId: round.decisions[0]!.id,
      answerKind: "accepted-recommendation",
    });
    const next = await submitRound.run({ id: round.id });

    expect(next.round?.decisions.map((card) => card.key)).toEqual(["storage"]);
    const tree = await getTree.run({ sessionId: session.id });
    expect(
      tree.decisions.map((decision) => [decision.key, decision.state]),
    ).toEqual([
      ["shape", "settled"],
      ["storage", "frontier"],
      ["sync", "blocked"],
    ]);
  });
});

/**
 * Reopening a settled decision puts every decision under it in doubt. The
 * interviewer is not troubled with that until the reopened question has an
 * answer again — which is a round submission, and so is covered here.
 */
describe("submit-round stale review", () => {
  useTestDatabase();
  afterEach(resetInterviewer);

  const nothingMore = proposal();

  function review(
    ...verdicts: {
      key: string;
      verdict: "reconfirm" | "re-ask";
      reason?: string;
      title?: string;
      body?: string;
      choices?: string[];
      recommendedAnswer?: string;
    }[]
  ): ScriptedTurn {
    return {
      kind: "review-stale",
      result: {
        reviews: verdicts.map((verdict) => ({
          decisionKey: verdict.key,
          verdict: verdict.verdict,
          reason: verdict.reason ?? `What ${verdict.key} rests on moved.`,
          title: verdict.title ?? null,
          body: verdict.body ?? null,
          choices: verdict.choices ?? [],
          recommendedAnswer: verdict.recommendedAnswer ?? null,
        })),
      },
    };
  }

  /** Answers every card of the open round the same way, and submits it. */
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

  /** shape -> storage -> sync, each asked and answered in its own round. */
  async function aSettledChain(...trailing: ScriptedTurn[]): Promise<{
    sessionId: string;
    interviewer: FakeInterviewer;
  }> {
    const session = await createSession.run({
      title: "Grill Room",
      idea: "A local app that grills me about an idea until it is decided.",
    });
    const interviewer = scriptInterviewer([
      proposal({ key: "shape", title: "What shape?" }),
      proposal({
        key: "storage",
        title: "Where does the data live?",
        dependsOn: ["shape"],
      }),
      proposal({
        key: "sync",
        title: "How does it sync?",
        dependsOn: ["storage"],
      }),
      ...trailing,
    ]);

    await requestNextRound.run({ sessionId: session.id });
    await answerOpenRound(session.id, "A workspace");
    await answerOpenRound(session.id, "On disk");
    await answerOpenRound(session.id, "Poll");

    return { sessionId: session.id, interviewer };
  }

  type TreeDecisionView = Awaited<
    ReturnType<typeof getTree.run>
  >["decisions"][number];

  async function treeBy(
    sessionId: string,
  ): Promise<Record<string, TreeDecisionView | undefined>> {
    const tree = await getTree.run({ sessionId });
    return Object.fromEntries(
      tree.decisions.map((decision) => [decision.key, decision]),
    );
  }

  it("reviews what the reopened answer put in doubt before asking for a new round", async () => {
    const { sessionId, interviewer } = await aSettledChain(
      nothingMore,
      review(
        { key: "storage", verdict: "reconfirm" },
        { key: "sync", verdict: "reconfirm" },
      ),
      nothingMore,
    );

    const reopened = (await treeBy(sessionId)).shape!;
    await reopenDecision.run({ decisionId: reopened.id });
    await answerOpenRound(sessionId, "A page, after all");

    expect(interviewer.requests.map((request) => request.kind)).toEqual([
      "propose-round",
      "propose-round",
      "propose-round",
      "propose-round",
      "review-stale",
      "propose-round",
    ]);
    expect(interviewer.requests[4]).toMatchObject({
      kind: "review-stale",
      reopenedDecisionKey: "shape",
      staleDecisionKeys: ["storage", "sync"],
      rejectionReason: null,
    });

    const tree = await treeBy(sessionId);
    expect([tree.shape?.state, tree.storage?.state, tree.sync?.state]).toEqual([
      "settled",
      "settled",
      "settled",
    ]);
    expect(tree.storage?.answer).toEqual({ text: "On disk", kind: "own-answer" });
  });

  it("applies a mixed review: one reconfirmed, one re-asked with a new question", async () => {
    const { sessionId } = await aSettledChain(
      nothingMore,
      review(
        { key: "storage", verdict: "reconfirm", reason: "Disk either way." },
        {
          key: "sync",
          verdict: "re-ask",
          reason: "A page syncs differently.",
          title: "How does a page stay current?",
          body: "The old answer assumed a workspace.",
          choices: ["Poll", "Push"],
          recommendedAnswer: "Push",
        },
      ),
      nothingMore,
    );

    const reopened = (await treeBy(sessionId)).shape!;
    await reopenDecision.run({ decisionId: reopened.id });
    const next = await answerOpenRound(sessionId, "A page, after all");

    const tree = await treeBy(sessionId);
    expect(tree.storage).toMatchObject({
      state: "settled",
      answer: { text: "On disk", kind: "own-answer" },
    });
    expect(tree.sync).toMatchObject({
      state: "frontier",
      answer: null,
      settledAt: null,
      questionTitle: "How does a page stay current?",
      questionBody: "The old answer assumed a workspace.",
      choices: ["Poll", "Push"],
      recommendedAnswer: "Push",
    });
    expect(
      tree.sync?.previousAnswers.map((entry) => [entry.text, entry.kind]),
    ).toEqual([["Poll", "own-answer"]]);
    expect(
      tree.storage?.previousAnswers.map((entry) => [entry.text, entry.kind]),
    ).toEqual([["On disk", "own-answer"]]);
    // The re-asked question rejoins the tree through the ordinary frontier
    // rule, so the next round asks it again.
    expect(next.round?.decisions.map((card) => card.key)).toEqual(["sync"]);

    // Why each verdict was reached is kept with the answer it superseded.
    const recorded = await getDb()
      .select()
      .from(schema.decisionHistory)
      .where(eq(schema.decisionHistory.decisionId, tree.sync!.id));
    expect(recorded[0]?.questionBody).toContain("A page syncs differently.");
  });

  it("leaves nothing stale once every dependent has been ruled on", async () => {
    const { sessionId, interviewer } = await aSettledChain(
      nothingMore,
      review(
        { key: "storage", verdict: "reconfirm" },
        { key: "sync", verdict: "re-ask", title: "How does a page sync?" },
      ),
      nothingMore,
      nothingMore,
    );

    const reopened = (await treeBy(sessionId)).shape!;
    await reopenDecision.run({ decisionId: reopened.id });
    // The reopened answer, then the re-asked question the review handed back.
    await answerOpenRound(sessionId, "A page, after all");
    await answerOpenRound(sessionId, "It polls");

    const tree = await treeBy(sessionId);
    expect([tree.shape?.state, tree.storage?.state, tree.sync?.state]).toEqual([
      "settled",
      "settled",
      "settled",
    ]);
    // Reconfirming and re-asking is the whole of the debt: the reopen stamp
    // outlives the answer, but nothing is owed under it a second time.
    expect(tree.shape?.reopenedAt).toEqual(expect.stringMatching(/^\d{4}-/));
    expect(
      interviewer.requests.filter((request) => request.kind === "review-stale"),
    ).toHaveLength(1);
  });

  it("reviews again when the same decision is reopened a second time", async () => {
    const bothReconfirmed = review(
      { key: "storage", verdict: "reconfirm" },
      { key: "sync", verdict: "reconfirm" },
    );
    const { sessionId, interviewer } = await aSettledChain(
      nothingMore,
      bothReconfirmed,
      nothingMore,
      bothReconfirmed,
      nothingMore,
    );

    const shapeId = (await treeBy(sessionId)).shape!.id;

    await reopenDecision.run({ decisionId: shapeId });
    await answerOpenRound(sessionId, "A page, after all");
    expect([
      (await treeBy(sessionId)).storage?.state,
      (await treeBy(sessionId)).sync?.state,
    ]).toEqual(["settled", "settled"]);

    await reopenDecision.run({ decisionId: shapeId });
    expect([
      (await treeBy(sessionId)).storage?.state,
      (await treeBy(sessionId)).sync?.state,
    ]).toEqual(["stale", "stale"]);

    await answerOpenRound(sessionId, "A workspace again");

    const reviews = interviewer.requests.filter(
      (request) => request.kind === "review-stale",
    );
    expect(reviews).toHaveLength(2);
    expect(reviews[1]).toMatchObject({
      reopenedDecisionKey: "shape",
      staleDecisionKeys: ["storage", "sync"],
    });
    const tree = await treeBy(sessionId);
    expect([tree.shape?.state, tree.storage?.state, tree.sync?.state]).toEqual([
      "settled",
      "settled",
      "settled",
    ]);
  });

  it("leaves stale decisions alone while the reopened one is still unanswered", async () => {
    const { sessionId, interviewer } = await aSettledChain(
      proposal({ key: "tone", title: "How blunt?" }),
      nothingMore,
    );

    // Reopened but not yet answered: the round being submitted is about
    // something else entirely.
    const shape = (await treeBy(sessionId)).shape!;
    await getDb()
      .update(schema.decisions)
      .set({
        currentAnswer: null,
        answerKind: null,
        settledAt: null,
        reopenedAt: new Date(Date.now() + 1000).toISOString(),
      })
      .where(eq(schema.decisions.id, shape.id));

    await answerOpenRound(sessionId, "Blunt");

    expect(
      interviewer.requests.filter((request) => request.kind === "review-stale"),
    ).toEqual([]);
    const tree = await treeBy(sessionId);
    expect([tree.storage?.state, tree.sync?.state]).toEqual(["stale", "stale"]);
  });

  it("sends an incomplete review back with the reason and applies the corrected one", async () => {
    const { sessionId, interviewer } = await aSettledChain(
      nothingMore,
      review({ key: "storage", verdict: "reconfirm" }),
      review(
        { key: "storage", verdict: "reconfirm" },
        { key: "sync", verdict: "reconfirm" },
      ),
      nothingMore,
    );

    const reopened = (await treeBy(sessionId)).shape!;
    await reopenDecision.run({ decisionId: reopened.id });
    await answerOpenRound(sessionId, "A page, after all");

    expect(interviewer.requests.map((request) => request.kind)).toEqual([
      "propose-round",
      "propose-round",
      "propose-round",
      "propose-round",
      "review-stale",
      "review-stale",
      "propose-round",
    ]);
    expect(interviewer.requests[5]).toMatchObject({
      rejectionReason: expect.stringContaining(
        'Decision "sync" is stale and was not ruled on',
      ),
    });
    const tree = await treeBy(sessionId);
    expect([tree.storage?.state, tree.sync?.state]).toEqual([
      "settled",
      "settled",
    ]);
  });

  it("gives up after two retries, changes nothing, and records the failed turn", async () => {
    const overComplete = review(
      { key: "storage", verdict: "reconfirm" },
      { key: "sync", verdict: "reconfirm" },
      { key: "shape", verdict: "re-ask" },
    );
    const { sessionId, interviewer } = await aSettledChain(
      nothingMore,
      overComplete,
      overComplete,
      overComplete,
    );

    const reopened = (await treeBy(sessionId)).shape!;
    await reopenDecision.run({ decisionId: reopened.id });

    await expect(answerOpenRound(sessionId, "A page, after all")).rejects.toThrow(
      /reviewed the stale decisions wrongly 3 times/,
    );

    expect(
      interviewer.requests.filter((request) => request.kind === "review-stale"),
    ).toHaveLength(3);
    expect(interviewer.requests[4]).toMatchObject({
      rejectionReason: null,
    });
    expect(interviewer.requests[5]).toMatchObject({
      rejectionReason: expect.stringContaining(
        'Decision "shape" was ruled on but is not one of the stale decisions',
      ),
    });
    expect(await getSession.run({ id: sessionId })).toMatchObject({
      turnStatus: "failed",
      turnErrorCode: "invalid-review",
    });

    const tree = await treeBy(sessionId);
    expect(tree.storage).toMatchObject({
      state: "stale",
      answer: { text: "On disk", kind: "own-answer" },
      previousAnswers: [],
    });
    expect(tree.sync).toMatchObject({ state: "stale", previousAnswers: [] });
  });
});

describe("list-rounds", () => {
  useTestDatabase();
  afterEach(resetInterviewer);

  it("throws for a session id that does not exist", async () => {
    await expect(listRounds.run({ sessionId: "missing" })).rejects.toThrow(
      "Session not found: missing",
    );
  });

  it("is empty before the interview starts", async () => {
    const session = await aSession();

    expect(await listRounds.run({ sessionId: session.id })).toEqual({
      sessionId: session.id,
      rounds: [],
    });
  });

  it("keeps every round in order with the answer each card was given", async () => {
    const { session, round } = await aSessionMidRound(
      proposal({ key: "shape", title: "What shape?" }),
      proposal({
        key: "storage",
        title: "Where does the data live?",
        dependsOn: ["shape"],
      }),
    );

    await saveDraftAnswer.run({
      decisionId: round.decisions[0]!.id,
      answerKind: "own-answer",
      answer: "A workspace beside the tree",
    });
    await submitRound.run({ id: round.id });

    const history = await listRounds.run({ sessionId: session.id });

    expect(history.rounds).toHaveLength(2);
    expect(history.rounds[0]).toMatchObject({
      submissionState: "submitted",
      decisions: [
        {
          key: "shape",
          questionTitle: "What shape?",
          answeredInRound: {
            answer: "A workspace beside the tree",
            answerKind: "own-answer",
          },
        },
      ],
    });
    expect(history.rounds[0]?.submittedAt).toEqual(
      expect.stringMatching(/^\d{4}-/),
    );
    expect(history.rounds[1]).toMatchObject({
      submissionState: "open",
      submittedAt: null,
      decisions: [{ key: "storage", answeredInRound: null }],
    });
  });
});
