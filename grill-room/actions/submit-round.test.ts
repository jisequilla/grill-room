import { afterEach, describe, expect, it } from "vitest";

import {
  resetInterviewer,
  scriptInterviewer,
  type ScriptedTurn,
} from "../server/interviewer/index.js";
import { useTestDatabase } from "../test/db.js";
import createSession from "./create-session.js";
import getCurrentRound from "./get-current-round.js";
import getTree from "./get-tree.js";
import listRounds from "./list-rounds.js";
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
