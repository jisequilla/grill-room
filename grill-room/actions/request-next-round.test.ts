import { eq } from "@agent-native/core/db/schema";
import { afterEach, describe, expect, it } from "vitest";

import {
  InterviewerError,
  resetInterviewer,
  scriptInterviewer,
} from "../server/interviewer/index.js";
import { getDb, schema, useTestDatabase } from "../test/db.js";
import addDecision from "./add-decision.js";
import createSession from "./create-session.js";
import getCurrentRound from "./get-current-round.js";
import getSession from "./get-session.js";
import getTree from "./get-tree.js";
import requestNextRound from "./request-next-round.js";
import saveDraftAnswer from "./save-draft-answer.js";
import submitRound from "./submit-round.js";

/*
 * `get-current-round` is covered here rather than in its own file. The harness
 * builds one database per test file, and the suite already runs more files than
 * this machine has cores: past that point the per-file build outruns vitest's
 * hook timeout and unrelated files fail. Reads that only report what this
 * action wrote therefore travel with it.
 */

/** One proposed decision, with everything but the point of the test defaulted. */
function proposed(
  overrides: Partial<{
    key: string;
    title: string;
    body: string;
    choices: string[];
    recommendedAnswer: string;
    dependsOn: string[];
    ask: boolean;
  }> = {},
) {
  return {
    key: "shape",
    title: "What shape should this take?",
    body: "The first thing to settle.",
    choices: [],
    recommendedAnswer: "A workspace",
    dependsOn: [],
    ask: true,
    ...overrides,
  };
}

function round(...proposedDecisions: ReturnType<typeof proposed>[]) {
  return {
    kind: "propose-round" as const,
    result: {
      proposedDecisions,
      pushBackResponses: [],
      userDecisionPlacements: [],
      done: null,
    },
  };
}

function aSession(overrides: { answeringMode?: "one-at-a-time" } = {}) {
  return createSession.run({
    title: "Grill Room",
    idea: "A local app that grills me about an idea until it is decided.",
    model: "sonnet",
    ...overrides,
  });
}

describe("request-next-round", () => {
  useTestDatabase();
  afterEach(resetInterviewer);

  it("throws for a session id that does not exist", async () => {
    await expect(requestNextRound.run({ sessionId: "missing" })).rejects.toThrow(
      "Session not found: missing",
    );
  });

  it("opens the first round from the interviewer's proposal", async () => {
    const session = await aSession();
    const interviewer = scriptInterviewer([
      round(
        proposed({ key: "shape", choices: ["A page", "A workspace"] }),
        proposed({ key: "tone", title: "How blunt should it be?" }),
      ),
    ]);

    const result = await requestNextRound.run({ sessionId: session.id });

    expect(result.turnStatus).toBe("idle");
    expect(result.turnError).toBeNull();
    expect(result.round?.decisions.map((card) => card.key)).toEqual([
      "shape",
      "tone",
    ]);
    expect(result.round?.decisions[0]).toMatchObject({
      questionTitle: "What shape should this take?",
      choices: ["A page", "A workspace"],
      recommendedAnswer: "A workspace",
      state: "frontier",
      draft: null,
    });
    expect(interviewer.requests).toHaveLength(1);
    expect(interviewer.requests[0]).toMatchObject({
      kind: "propose-round",
      rejectionReason: null,
      latestAnswers: [],
    });
  });

  it("stores the conversation id the turn returned", async () => {
    const session = await aSession();
    scriptInterviewer([
      { ...round(proposed()), conversationId: "conversation-7" },
    ]);

    await requestNextRound.run({ sessionId: session.id });

    expect(await getSession.run({ id: session.id })).toMatchObject({
      conversationId: "conversation-7",
      turnStatus: "idle",
    });
  });

  it("returns the open round instead of asking the interviewer again", async () => {
    const session = await aSession();
    const interviewer = scriptInterviewer([round(proposed())]);

    const first = await requestNextRound.run({ sessionId: session.id });
    const second = await requestNextRound.run({ sessionId: session.id });

    expect(second.round?.id).toBe(first.round?.id);
    expect(interviewer.requests).toHaveLength(1);
  });

  it("refuses a second request while a turn is working", async () => {
    const session = await aSession();
    await getDb()
      .update(schema.sessions)
      .set({ turnStatus: "working", turnStartedAt: new Date().toISOString() })
      .where(eq(schema.sessions.id, session.id));

    await expect(
      requestNextRound.run({ sessionId: session.id }),
    ).rejects.toThrow(/already working/);
  });

  it("puts decisions the interviewer did not ask into the tree but not the round", async () => {
    const session = await aSession();
    scriptInterviewer([
      round(
        proposed({ key: "shape" }),
        proposed({
          key: "storage",
          title: "Where does the data live?",
          dependsOn: ["shape"],
          ask: false,
        }),
      ),
    ]);

    const result = await requestNextRound.run({ sessionId: session.id });
    const tree = await getTree.run({ sessionId: session.id });

    expect(result.round?.decisions.map((card) => card.key)).toEqual(["shape"]);
    expect(
      tree.decisions.map((decision) => [decision.key, decision.state]),
    ).toEqual([
      ["shape", "frontier"],
      ["storage", "blocked"],
    ]);
    expect(tree.decisions[1]?.dependsOn).toEqual([tree.decisions[0]?.id]);
  });

  describe("proposal validation", () => {
    it("rejects a question that is not on the frontier and re-asks with the reason", async () => {
      const session = await aSession();
      const interviewer = scriptInterviewer([
        round(
          proposed({ key: "shape", ask: false }),
          proposed({ key: "storage", dependsOn: ["shape"], ask: true }),
        ),
        round(proposed({ key: "shape" })),
      ]);

      const result = await requestNextRound.run({ sessionId: session.id });

      expect(interviewer.requests).toHaveLength(2);
      expect(interviewer.requests[1]).toMatchObject({
        rejectionReason: expect.stringContaining("not on the frontier"),
      });
      expect(result.round?.decisions.map((card) => card.key)).toEqual(["shape"]);
      const tree = await getTree.run({ sessionId: session.id });
      expect(tree.decisions.map((decision) => decision.key)).toEqual(["shape"]);
    });

    it("rejects a dependency link that points at nothing", async () => {
      const session = await aSession();
      const interviewer = scriptInterviewer([
        round(proposed({ key: "storage", dependsOn: ["never-proposed"] })),
        round(proposed({ key: "shape" })),
      ]);

      await requestNextRound.run({ sessionId: session.id });

      expect(interviewer.requests[1]).toMatchObject({
        rejectionReason: expect.stringContaining(
          'depends on "never-proposed", which is neither an existing decision nor part of this proposal',
        ),
      });
    });

    it("rejects links that form a cycle", async () => {
      const session = await aSession();
      const interviewer = scriptInterviewer([
        round(
          proposed({ key: "shape", dependsOn: ["storage"], ask: false }),
          proposed({ key: "storage", dependsOn: ["shape"], ask: false }),
        ),
        round(proposed({ key: "shape" })),
      ]);

      await requestNextRound.run({ sessionId: session.id });

      expect(interviewer.requests[1]).toMatchObject({
        rejectionReason: expect.stringContaining("dependency cycle"),
      });
    });

    it("rejects a key that an existing decision already uses", async () => {
      const session = await aSession();
      const now = new Date().toISOString();
      await getDb().insert(schema.decisions).values({
        id: "decision-shape",
        sessionId: session.id,
        key: "shape",
        questionTitle: "What shape should this take?",
        currentAnswer: "A workspace",
        answerKind: "own-answer",
        settledAt: now,
        createdAt: now,
        updatedAt: now,
      });
      const interviewer = scriptInterviewer([
        round(proposed({ key: "shape" })),
        round(proposed({ key: "tone", title: "How blunt should it be?" })),
      ]);

      await requestNextRound.run({ sessionId: session.id });

      expect(interviewer.requests[1]).toMatchObject({
        rejectionReason: expect.stringContaining(
          'Decision "shape" is already in the tree',
        ),
      });
    });

    it("gives up after two retries, stores nothing, and records the failed turn", async () => {
      const session = await aSession();
      const bad = round(
        proposed({ key: "shape", ask: false }),
        proposed({ key: "storage", dependsOn: ["shape"], ask: true }),
      );
      const interviewer = scriptInterviewer([bad, bad, bad]);

      await expect(
        requestNextRound.run({ sessionId: session.id }),
      ).rejects.toThrow(/does not fit the design tree 3 times/);

      expect(interviewer.requests).toHaveLength(3);
      expect((await getTree.run({ sessionId: session.id })).decisions).toEqual(
        [],
      );
      expect(
        await getDb()
          .select()
          .from(schema.rounds)
          .where(eq(schema.rounds.sessionId, session.id)),
      ).toEqual([]);
      expect(await getSession.run({ id: session.id })).toMatchObject({
        turnStatus: "failed",
        turnErrorCode: "invalid-proposal",
      });
    });
  });

  describe("push backs", () => {
    /** A decision the user has already pushed back on, with its reason. */
    async function arrangePushedBackDecision(
      sessionId: string,
      decision: { id: string; key: string; title: string; body?: string; reason: string },
    ) {
      const now = new Date().toISOString();
      await getDb()
        .insert(schema.decisions)
        .values({
          id: decision.id,
          sessionId,
          key: decision.key,
          questionTitle: decision.title,
          questionBody: decision.body ?? "",
          currentAnswer: decision.reason,
          answerKind: "pushed-back",
          dependsOnJson: "[]",
          createdAt: now,
          updatedAt: now,
        });
    }

    it("rejects a proposal that leaves a pending push back unanswered, and accepts once it responds", async () => {
      const session = await aSession();
      await arrangePushedBackDecision(session.id, {
        id: "decision-shape",
        key: "shape",
        title: "What shape?",
        reason: "Too vague.",
      });
      const interviewer = scriptInterviewer([
        round(),
        {
          kind: "propose-round",
          result: {
            proposedDecisions: [],
            pushBackResponses: [
              {
                decisionKey: "shape",
                response: "withdraw",
                explanation: "Dropping it; scope moved on.",
                replacementKey: null,
              },
            ],
            userDecisionPlacements: [],
            done: null,
          },
        },
      ]);

      await requestNextRound.run({ sessionId: session.id });

      expect(interviewer.requests).toHaveLength(2);
      expect(interviewer.requests[1]).toMatchObject({
        rejectionReason: expect.stringContaining(
          'Decision "shape" was pushed back and needs a response',
        ),
      });

      const tree = await getTree.run({ sessionId: session.id });
      expect(tree.decisions).toMatchObject([{ key: "shape", state: "withdrawn" }]);

      const history = await getDb()
        .select()
        .from(schema.decisionHistory)
        .where(eq(schema.decisionHistory.decisionId, "decision-shape"));
      expect(history).toMatchObject([
        { answer: "Dropping it; scope moved on.", answerKind: "pushed-back" },
      ]);
    });

    it("rejects a push back response that re-asks the same decision unchanged", async () => {
      const session = await aSession();
      await arrangePushedBackDecision(session.id, {
        id: "decision-shape",
        key: "shape",
        title: "What shape?",
        body: "The first thing to settle.",
        reason: "Too vague.",
      });
      const unchanged = {
        kind: "propose-round" as const,
        result: {
          proposedDecisions: [
            proposed({
              key: "shape-2",
              title: "What shape?",
              body: "The first thing to settle.",
            }),
          ],
          pushBackResponses: [
            {
              decisionKey: "shape",
              response: "replace" as const,
              explanation: "Replacing it.",
              replacementKey: "shape-2",
            },
          ],
          userDecisionPlacements: [],
          done: null,
        },
      };
      const interviewer = scriptInterviewer([unchanged, unchanged, unchanged]);

      await expect(
        requestNextRound.run({ sessionId: session.id }),
      ).rejects.toThrow(/re-asks it unchanged/);
      expect(interviewer.requests).toHaveLength(3);
    });

    it("accepts a replacement that genuinely differs from the pushed-back question", async () => {
      const session = await aSession();
      await arrangePushedBackDecision(session.id, {
        id: "decision-shape",
        key: "shape",
        title: "What shape?",
        body: "The first thing to settle.",
        reason: "Too vague.",
      });
      scriptInterviewer([
        {
          kind: "propose-round",
          result: {
            proposedDecisions: [
              proposed({
                key: "shape-2",
                title: "What shape, specifically?",
                body: "A narrower question.",
              }),
            ],
            pushBackResponses: [
              {
                decisionKey: "shape",
                response: "replace",
                explanation: "Narrowed it down.",
                replacementKey: "shape-2",
              },
            ],
            userDecisionPlacements: [],
            done: null,
          },
        },
      ]);

      const result = await requestNextRound.run({ sessionId: session.id });

      const tree = await getTree.run({ sessionId: session.id });
      expect(
        tree.decisions.map((decision) => [decision.key, decision.state]),
      ).toEqual([
        ["shape", "withdrawn"],
        ["shape-2", "frontier"],
      ]);
      expect(result.round?.decisions.map((card) => card.key)).toEqual([
        "shape-2",
      ]);
    });
  });

  describe("user-added decisions", () => {
    it("sends a user-added decision to the interviewer and rejects a proposal that leaves it unplaced", async () => {
      const session = await aSession();
      const added = await addDecision.run({
        sessionId: session.id,
        title: "Should we support offline mode?",
        body: "Came to me in the shower.",
      });

      const interviewer = scriptInterviewer([
        round(),
        {
          kind: "propose-round",
          result: {
            proposedDecisions: [],
            pushBackResponses: [],
            userDecisionPlacements: [
              proposed({
                key: added.key as string,
                dependsOn: [],
                ask: true,
                recommendedAnswer: "Not for the first version.",
              }),
            ],
            done: null,
          },
        },
      ]);

      const result = await requestNextRound.run({ sessionId: session.id });

      expect(interviewer.requests).toHaveLength(2);
      expect(interviewer.requests[0]).toMatchObject({
        userAddedDecisions: [
          {
            key: added.key,
            title: "Should we support offline mode?",
            body: "Came to me in the shower.",
          },
        ],
      });
      expect(interviewer.requests[1]).toMatchObject({
        rejectionReason: expect.stringContaining("needs a placement"),
      });

      const tree = await getTree.run({ sessionId: session.id });
      expect(tree.decisions).toMatchObject([
        { key: added.key, state: "frontier" },
      ]);
      expect(result.round?.decisions.map((card) => card.key)).toEqual([
        added.key,
      ]);
    });

    it("rejects a placement whose dependsOn dangles", async () => {
      const session = await aSession();
      const added = await addDecision.run({
        sessionId: session.id,
        title: "Add analytics?",
        body: "",
      });
      const bad = {
        kind: "propose-round" as const,
        result: {
          proposedDecisions: [],
          pushBackResponses: [],
          userDecisionPlacements: [
            proposed({
              key: added.key as string,
              dependsOn: ["never-proposed"],
              ask: false,
            }),
          ],
          done: null,
        },
      };
      const interviewer = scriptInterviewer([bad, bad, bad]);

      await expect(
        requestNextRound.run({ sessionId: session.id }),
      ).rejects.toThrow(
        /neither an existing decision nor part of this proposal/,
      );
      expect(interviewer.requests).toHaveLength(3);
    });

    it("rejects a placement that does not match any decision awaiting placement", async () => {
      const session = await aSession();
      const bad = {
        kind: "propose-round" as const,
        result: {
          proposedDecisions: [],
          pushBackResponses: [],
          userDecisionPlacements: [
            proposed({ key: "not-awaiting", dependsOn: [], ask: false }),
          ],
          done: null,
        },
      };
      const interviewer = scriptInterviewer([bad, bad, bad]);

      await expect(
        requestNextRound.run({ sessionId: session.id }),
      ).rejects.toThrow(/is not a decision awaiting placement/);
      expect(interviewer.requests).toHaveLength(3);
    });
  });

  describe("interviewer failures", () => {
    it("records malformed output as a failed turn and stores no decisions", async () => {
      const session = await aSession();
      scriptInterviewer([
        { kind: "propose-round", invalidResult: { proposedDecisions: "nope" } },
      ]);

      await expect(
        requestNextRound.run({ sessionId: session.id }),
      ).rejects.toThrow(/does not match the expected shape/);

      expect((await getTree.run({ sessionId: session.id })).decisions).toEqual(
        [],
      );
      expect(await getSession.run({ id: session.id })).toMatchObject({
        turnStatus: "failed",
        turnErrorCode: "malformed-output",
      });
    });

    it("records a rate limit under its own code so it is not read as a defect", async () => {
      const session = await aSession();
      scriptInterviewer([
        {
          kind: "propose-round",
          error: new InterviewerError(
            "rate-limited",
            "The Claude subscription's limit is reached.",
          ),
        },
      ]);

      await expect(
        requestNextRound.run({ sessionId: session.id }),
      ).rejects.toThrow("The Claude subscription's limit is reached.");

      expect(await getSession.run({ id: session.id })).toMatchObject({
        turnStatus: "failed",
        turnErrorCode: "rate-limited",
        turnErrorMessage: "The Claude subscription's limit is reached.",
      });
    });

    it("lets a failed turn be retried", async () => {
      const session = await aSession();
      scriptInterviewer([
        {
          kind: "propose-round",
          error: new InterviewerError("failed", "The turn died."),
        },
        round(proposed()),
      ]);

      await expect(
        requestNextRound.run({ sessionId: session.id }),
      ).rejects.toThrow("The turn died.");

      const retried = await requestNextRound.run({ sessionId: session.id });

      expect(retried.turnStatus).toBe("idle");
      expect(retried.turnError).toBeNull();
      expect(retried.round?.decisions).toHaveLength(1);
    });
  });

  describe("one at a time", () => {
    it("opens one card per round and drains the proposal without asking again", async () => {
      const session = await aSession({ answeringMode: "one-at-a-time" });
      const interviewer = scriptInterviewer([
        round(
          proposed({ key: "shape" }),
          proposed({ key: "tone", title: "How blunt should it be?" }),
        ),
      ]);

      const first = await requestNextRound.run({ sessionId: session.id });
      expect(first.round?.decisions.map((card) => card.key)).toEqual(["shape"]);
      expect(
        (await getTree.run({ sessionId: session.id })).decisions,
      ).toHaveLength(2);

      await saveDraftAnswer.run({
        decisionId: first.round!.decisions[0]!.id,
        answerKind: "accepted-recommendation",
      });
      const second = await submitRound.run({ id: first.round!.id });

      expect(second.round?.decisions.map((card) => card.key)).toEqual(["tone"]);
      expect(interviewer.requests).toHaveLength(1);
    });

    it("serves a decision unblocked by settling the round as its own round, without asking again", async () => {
      const session = await aSession({ answeringMode: "one-at-a-time" });
      const interviewer = scriptInterviewer([
        round(
          proposed({ key: "shape" }),
          proposed({
            key: "storage",
            title: "Where does the data live?",
            dependsOn: ["shape"],
            ask: false,
          }),
        ),
      ]);

      const first = await requestNextRound.run({ sessionId: session.id });
      expect(first.round?.decisions.map((card) => card.key)).toEqual(["shape"]);

      await saveDraftAnswer.run({
        decisionId: first.round!.decisions[0]!.id,
        answerKind: "accepted-recommendation",
      });
      const second = await submitRound.run({ id: first.round!.id });

      expect(second.round?.decisions.map((card) => card.key)).toEqual([
        "storage",
      ]);
      expect(interviewer.requests).toHaveLength(1);
    });
  });

  it("ends with no open round when the interviewer has nothing to propose", async () => {
    const session = await aSession();
    scriptInterviewer([round()]);

    const result = await requestNextRound.run({ sessionId: session.id });

    expect(result.round).toBeNull();
    expect(result.turnStatus).toBe("idle");
    expect((await getTree.run({ sessionId: session.id })).decisions).toEqual(
      [],
    );
  });

  it("shows the interviewer the settled tree on the next turn", async () => {
    const session = await aSession();
    const interviewer = scriptInterviewer([
      round(proposed({ key: "shape" })),
      round(
        proposed({
          key: "storage",
          title: "Where does the data live?",
          dependsOn: ["shape"],
        }),
      ),
    ]);

    const first = await requestNextRound.run({ sessionId: session.id });
    await saveDraftAnswer.run({
      decisionId: first.round!.decisions[0]!.id,
      answerKind: "own-answer",
      answer: "A workspace beside the tree",
    });
    await submitRound.run({ id: first.round!.id });

    expect(interviewer.requests[1]).toMatchObject({
      latestAnswers: [
        {
          decisionKey: "shape",
          kind: "own-answer",
          text: "A workspace beside the tree",
        },
      ],
      context: {
        decisions: [
          {
            key: "shape",
            state: "settled",
            answer: { kind: "own-answer", text: "A workspace beside the tree" },
          },
        ],
      },
    });
    expect(
      (await getCurrentRound.run({ sessionId: session.id })).round?.decisions[0],
    ).toMatchObject({ key: "storage", state: "frontier" });
  });
});

describe("get-current-round", () => {
  useTestDatabase();

  it("throws for a session id that does not exist", async () => {
    await expect(getCurrentRound.run({ sessionId: "missing" })).rejects.toThrow(
      "Session not found: missing",
    );
  });

  it("reports no round and an idle turn before the interview starts", async () => {
    const session = await aSession();

    expect(await getCurrentRound.run({ sessionId: session.id })).toEqual({
      sessionId: session.id,
      turnStatus: "idle",
      turnStartedAt: null,
      turnError: null,
      round: null,
    });
  });

  it("reports a working turn so a reload mid-turn shows the interviewer is busy", async () => {
    const session = await aSession();
    await getDb()
      .update(schema.sessions)
      .set({ turnStatus: "working", turnStartedAt: "2026-01-01T00:00:00.000Z" })
      .where(eq(schema.sessions.id, session.id));

    expect(await getCurrentRound.run({ sessionId: session.id })).toMatchObject({
      turnStatus: "working",
      turnStartedAt: "2026-01-01T00:00:00.000Z",
      round: null,
    });
  });
});
