import { eq } from "@agent-native/core/db/schema";
import { afterEach, describe, expect, it } from "vitest";

import {
  recommendedChoiceIndex,
  resolveRecommendedChoice,
} from "@/lib/recommended-choice";
import {
  InterviewerError,
  rateLimitedTurn,
  resetInterviewer,
  schemaInvalidTurn,
  scriptInterviewer,
  setInterviewer,
  treeRuleViolation,
  withResumeFallback,
} from "../server/interviewer/index.js";
import {
  aScoutProjectResult,
  anAssessReadinessResult,
  ideaEvidence,
  repoEvidence,
} from "../server/interviewer/test-fixtures.js";
import { runTurn, TurnRejected } from "../server/turn.js";
import { findLatestTurn } from "../server/turn-records.js";
import { getDb, schema, useTestDatabase } from "../test/db.js";
import { useTempGitRepos } from "../test/git-repos.js";
import addDecision from "./add-decision.js";
import assessReadiness from "./assess-readiness.js";
import createSession from "./create-session.js";
import getCurrentRound from "./get-current-round.js";
import getLatestTurn from "./get-latest-turn.js";
import getScoutReport from "./get-scout-report.js";
import getSession from "./get-session.js";
import getTree from "./get-tree.js";
import getTurn from "./get-turn.js";
import listRounds from "./list-rounds.js";
import registerProject from "./register-project.js";
import requestNextRound from "./request-next-round.js";
import saveDraftAnswer from "./save-draft-answer.js";
import scoutProject from "./scout-project.js";
import submitRound from "./submit-round.js";
import updateSessionIdea from "./update-session-idea.js";

/*
 * `get-current-round` is covered here rather than in its own file. The harness
 * builds one database per test file, and the suite already runs more files than
 * this machine has cores: past that point the per-file build outruns vitest's
 * hook timeout and unrelated files fail. Reads that only report what this
 * action wrote therefore travel with it.
 */

/**
 * A choice's rationale, derived from its label so a test that only cares about
 * the labels still produces the shape the port requires.
 */
function rationaleFor(label: string): string {
  return `Why ${label}`;
}

/** Labels as the port takes them: each with its own case. */
export function withRationales(labels: readonly string[]) {
  return labels.map((label) => ({ label, rationale: rationaleFor(label) }));
}

/** One proposed decision, with everything but the point of the test defaulted. */
function proposed(
  overrides: Partial<{
    key: string;
    title: string;
    body: string;
    /** Labels; each gets a derived rationale. */
    choices: string[];
    recommendedChoice: number | null;
    recommendedAnswer: string;
    dependsOn: string[];
    ask: boolean;
  }> = {},
) {
  const { choices, ...rest } = overrides;
  return {
    key: "shape",
    title: "What shape should this take?",
    body: "The first thing to settle.",
    choices: withRationales(choices ?? []),
    recommendedChoice: null,
    recommendedAnswer: "A workspace",
    dependsOn: [],
    ask: true,
    ...rest,
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

const readinessRepos = useTempGitRepos();

function readinessFixtureLines(count: number): string {
  return Array.from({ length: count }, (_, i) => `line ${i + 1}`).join("\n") + "\n";
}

/** A repo holding every file `aScoutProjectResult()` cites, at the lengths it cites. */
function aReadinessFixtureRepo(): string {
  return readinessRepos.create({
    files: {
      "src/ingest/metrics.ts": readinessFixtureLines(30),
      "docs/adr/0003-queue.md": readinessFixtureLines(9),
    },
  });
}

async function aSessionWithProject(root = aReadinessFixtureRepo()) {
  const project = await registerProject.run({
    root,
    verifyCommand: "pnpm test",
    exportFolder: ".scratch",
  });
  const session = await createSession.run({
    title: "Grill Room",
    idea: "A local app that grills me about an idea until it is decided.",
    model: "sonnet",
    projectId: project.id,
  });
  return { root, project, session };
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
      choices: withRationales(["A page", "A workspace"]),
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

  describe("choices and their rationales", () => {
    it("stores each choice's rationale beside its label, and the recommended index, and reads all three back", async () => {
      const session = await aSession();
      scriptInterviewer([
        {
          kind: "propose-round",
          result: {
            proposedDecisions: [
              {
                key: "shape",
                title: "What shape should this take?",
                body: "The first thing to settle.",
                choices: [
                  { label: "A page", rationale: "One scroll, and the tree hides." },
                  { label: "A workspace", rationale: "Three columns, more layout." },
                ],
                recommendedChoice: 1,
                recommendedAnswer:
                  "The workspace, because the tree beside the question is the point.",
                dependsOn: [],
                ask: true,
              },
            ],
            pushBackResponses: [],
            userDecisionPlacements: [],
            done: null,
          },
        },
      ]);

      const result = await requestNextRound.run({ sessionId: session.id });

      expect(result.round?.decisions[0]).toMatchObject({
        choices: [
          { label: "A page", rationale: "One scroll, and the tree hides." },
          { label: "A workspace", rationale: "Three columns, more layout." },
        ],
        recommendedChoice: 1,
        recommendedChoiceLabel: "A workspace",
      });

      const [stored] = await getDb()
        .select()
        .from(schema.decisions)
        .where(eq(schema.decisions.sessionId, session.id));

      expect(stored).toMatchObject({
        offeredChoicesJson: JSON.stringify(["A page", "A workspace"]),
        choiceRationalesJson: JSON.stringify([
          "One scroll, and the tree hides.",
          "Three columns, more layout.",
        ]),
        recommendedChoice: 1,
      });
    });

    it("marks the recommended chip from the index when the prose names no label at all", async () => {
      // The whole reason the index exists: across a real 72-decision session
      // the prose matcher hit on one round in five, and every miss recorded a
      // click on the recommended chip as the user's own answer.
      const session = await aSession();
      scriptInterviewer([
        round(
          proposed({
            choices: ["Hooks only", "OTel exporter only", "Hooks + OTel"],
            recommendedChoice: 2,
            recommendedAnswer:
              "Both, since each covers what the other misses on cost attribution.",
          }),
        ),
      ]);

      const result = await requestNextRound.run({ sessionId: session.id });
      const card = result.round!.decisions[0]!;

      expect(recommendedChoiceIndex(card.recommendedAnswer, card.choices.map((c) => c.label))).toBeNull();
      expect(resolveRecommendedChoice(card)).toBe(2);
      expect(card.recommendedChoiceLabel).toBe("Hooks + OTel");
    });

    it("reads a row stored before rationales existed as choices with none, and no recommended index", async () => {
      const session = await aSession();
      const now = new Date().toISOString();
      await getDb().insert(schema.decisions).values({
        id: "decision-legacy",
        sessionId: session.id,
        key: "legacy",
        questionTitle: "Where does the data live?",
        offeredChoicesJson: JSON.stringify(["In memory", "On disk"]),
        recommendedAnswer: "On disk, in the app's own database",
        createdAt: now,
        updatedAt: now,
      });

      const [view] = (await getTree.run({ sessionId: session.id })).decisions;

      expect(view).toMatchObject({
        choices: [
          { label: "In memory", rationale: "" },
          { label: "On disk", rationale: "" },
        ],
        recommendedChoice: null,
        recommendedChoiceLabel: null,
      });
    });
  });

  describe("proposal validation", () => {
    it("rejects a question that is not on the frontier and re-asks with the reason", async () => {
      const session = await aSession();
      const interviewer = scriptInterviewer([
        round(
          proposed({ key: "shape", ask: false }),
          proposed({
            key: "storage",
            title: "Where does the data live?",
            dependsOn: ["shape"],
            ask: true,
          }),
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
          proposed({
            key: "storage",
            title: "Where does the data live?",
            dependsOn: ["shape"],
            ask: false,
          }),
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

    it("rejects a new key that asks the same question as an existing live decision, naming the existing key", async () => {
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
        round(
          proposed({
            key: "shape-again",
            // Same question, different case and surrounding whitespace: the
            // comparison is normalised, not literal.
            title: "  WHAT SHAPE SHOULD THIS TAKE?  ",
          }),
        ),
        round(proposed({ key: "tone", title: "How blunt should it be?" })),
      ]);

      await requestNextRound.run({ sessionId: session.id });

      expect(interviewer.requests[1]).toMatchObject({
        rejectionReason: expect.stringContaining(
          'Decision "shape-again" asks the same question as "shape"',
        ),
      });
      expect(interviewer.requests[1]?.rejectionReason).not.toContain(
        "new key",
      );
    });

    it("rejects a key collision and a title collision without ever recommending a new key", async () => {
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
        round(
          proposed({ key: "shape" }),
          proposed({ key: "shape-again", title: "What shape should this take?" }),
        ),
        round(proposed({ key: "tone", title: "How blunt should it be?" })),
      ]);

      await requestNextRound.run({ sessionId: session.id });

      const rejectionReason = interviewer.requests[1]?.rejectionReason ?? "";
      expect(rejectionReason).toContain('Decision "shape" is already in the tree');
      expect(rejectionReason).toContain(
        'Decision "shape-again" asks the same question as "shape"',
      );
      expect(rejectionReason).not.toContain("new key");
    });

    it("rejects two proposed decisions in the same round asking the same question", async () => {
      const session = await aSession();
      const interviewer = scriptInterviewer([
        round(
          proposed({ key: "shape", title: "What shape should this take?" }),
          proposed({ key: "shape-too", title: "What shape should this take?" }),
        ),
        round(proposed({ key: "tone", title: "How blunt should it be?" })),
      ]);

      await requestNextRound.run({ sessionId: session.id });

      expect(interviewer.requests[1]).toMatchObject({
        rejectionReason: expect.stringContaining(
          'Decision "shape-too" asks the same question as "shape", proposed in the same round',
        ),
      });
    });

    it("accepts a push-back replacement that reuses the pushed-back decision's own title", async () => {
      const session = await aSession();
      const now = new Date().toISOString();
      await getDb()
        .insert(schema.decisions)
        .values({
          id: "decision-shape",
          sessionId: session.id,
          key: "shape",
          questionTitle: "What shape?",
          questionBody: "The first thing to settle.",
          currentAnswer: "Too vague.",
          answerKind: "pushed-back",
          dependsOnJson: "[]",
          createdAt: now,
          updatedAt: now,
        });
      scriptInterviewer([
        {
          kind: "propose-round",
          result: {
            proposedDecisions: [
              proposed({
                key: "shape-2",
                title: "What shape?",
                body: "A narrower version of the same question.",
              }),
            ],
            pushBackResponses: [
              {
                decisionKey: "shape",
                response: "replace",
                explanation: "Replacing it with a narrower version.",
                replacementKey: "shape-2",
              },
            ],
            userDecisionPlacements: [],
            done: null,
          },
        },
      ]);

      const result = await requestNextRound.run({ sessionId: session.id });

      expect(result.round?.decisions.map((card) => card.key)).toEqual([
        "shape-2",
      ]);
      const tree = await getTree.run({ sessionId: session.id });
      expect(
        tree.decisions.map((decision) => [decision.key, decision.state]),
      ).toEqual([
        ["shape", "withdrawn"],
        ["shape-2", "frontier"],
      ]);
    });

    it("accepts a proposal that reuses the title of an already-withdrawn decision", async () => {
      const session = await aSession();
      const now = new Date().toISOString();
      await getDb()
        .insert(schema.decisions)
        .values({
          id: "decision-shape",
          sessionId: session.id,
          key: "shape",
          questionTitle: "What shape should this take?",
          currentAnswer: "Dropped.",
          answerKind: "pushed-back",
          dependsOnJson: "[]",
          withdrawnAt: now,
          createdAt: now,
          updatedAt: now,
        });
      scriptInterviewer([
        round(
          proposed({ key: "shape-2", title: "What shape should this take?" }),
        ),
      ]);

      const result = await requestNextRound.run({ sessionId: session.id });

      expect(result.round?.decisions.map((card) => card.key)).toEqual([
        "shape-2",
      ]);
    });

    it("rejects a recommendedChoice that is not one of the decision's own choices", async () => {
      const session = await aSession();
      const interviewer = scriptInterviewer([
        round(
          proposed({ choices: ["A page", "A workspace"], recommendedChoice: 2 }),
        ),
        round(
          proposed({ choices: ["A page", "A workspace"], recommendedChoice: 1 }),
        ),
      ]);

      const result = await requestNextRound.run({ sessionId: session.id });

      expect(interviewer.requests[1]).toMatchObject({
        rejectionReason: expect.stringContaining(
          '`recommendedChoice` to 2, which is not one of its 2 choices',
        ),
      });
      expect(result.round?.decisions[0]).toMatchObject({
        recommendedChoice: 1,
        recommendedChoiceLabel: "A workspace",
      });
    });

    it("rejects a recommendedChoice on a decision that offers no choices", async () => {
      const session = await aSession();
      const bad = round(proposed({ choices: [], recommendedChoice: 0 }));
      const interviewer = scriptInterviewer([bad, bad, bad]);

      await expect(
        requestNextRound.run({ sessionId: session.id }),
      ).rejects.toThrow(/offers no choices/);
      expect(interviewer.requests).toHaveLength(3);
      expect(
        await getDb()
          .select()
          .from(schema.decisions)
          .where(eq(schema.decisions.sessionId, session.id)),
      ).toEqual([]);
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
      // The user's reason for pushing back stays the answer; the interviewer's
      // response to it is kept beside it, not on top of it.
      expect(history).toMatchObject([
        {
          answer: "Too vague.",
          answerKind: "pushed-back",
          interviewerReason: "Dropping it; scope moved on.",
        },
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
                choices: ["Not yet", "From the start"],
                recommendedChoice: 0,
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
      // A placement carries the choices, their rationales and the recommended
      // index the same way a proposal does: the user wrote the question, the
      // interviewer supplies everything needed to answer it.
      expect(tree.decisions).toMatchObject([
        {
          key: added.key,
          state: "frontier",
          choices: withRationales(["Not yet", "From the start"]),
          recommendedChoice: 0,
          recommendedChoiceLabel: "Not yet",
        },
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

  describe("done proposals", () => {
    it("accepts a done proposal that leaves nothing to ask, stores the summary, and opens no round", async () => {
      const session = await aSession();
      scriptInterviewer([
        {
          kind: "propose-round",
          result: {
            proposedDecisions: [],
            pushBackResponses: [],
            userDecisionPlacements: [],
            done: { summary: "Everything about grill-room is settled." },
          },
        },
      ]);

      const result = await requestNextRound.run({ sessionId: session.id });

      expect(result.round).toBeNull();
      expect(result.state).toBe("done-proposed");
      expect(result.doneSummary).toBe(
        "Everything about grill-room is settled.",
      );
      expect(await getSession.run({ id: session.id })).toMatchObject({
        state: "done-proposed",
        doneSummary: "Everything about grill-room is settled.",
      });
    });

    it("rejects a done proposal that still asks something, and retries with the reason", async () => {
      const session = await aSession();
      const interviewer = scriptInterviewer([
        {
          kind: "propose-round",
          result: {
            proposedDecisions: [proposed({ key: "shape", ask: true })],
            pushBackResponses: [],
            userDecisionPlacements: [],
            done: { summary: "Nothing left." },
          },
        },
        round(proposed({ key: "shape" })),
      ]);

      const result = await requestNextRound.run({ sessionId: session.id });

      expect(interviewer.requests).toHaveLength(2);
      expect(interviewer.requests[1]).toMatchObject({
        rejectionReason: expect.stringContaining("cannot be done"),
      });
      expect(result.state).toBe("interviewing");
      expect(result.round?.decisions.map((card) => card.key)).toEqual([
        "shape",
      ]);
    });

    it("rejects a done proposal that leaves an existing decision still to ask, and gives up after two retries storing nothing", async () => {
      const session = await aSession();
      const now = new Date().toISOString();
      await getDb().insert(schema.decisions).values({
        id: "decision-tone",
        sessionId: session.id,
        key: "tone",
        questionTitle: "How blunt should it be?",
        dependsOnJson: "[]",
        createdAt: now,
        updatedAt: now,
      });
      const bad = {
        kind: "propose-round" as const,
        result: {
          proposedDecisions: [],
          pushBackResponses: [],
          userDecisionPlacements: [],
          done: { summary: "Nothing left." },
        },
      };
      const interviewer = scriptInterviewer([bad, bad, bad]);

      await expect(
        requestNextRound.run({ sessionId: session.id }),
      ).rejects.toThrow(/does not fit the design tree 3 times/);

      expect(interviewer.requests).toHaveLength(3);
      expect(interviewer.requests[1]).toMatchObject({
        rejectionReason: expect.stringContaining("not actually done"),
      });
      expect(await getSession.run({ id: session.id })).toMatchObject({
        state: "interviewing",
        doneSummary: null,
        turnStatus: "failed",
        turnErrorCode: "invalid-proposal",
      });
      expect(
        (await getTree.run({ sessionId: session.id })).decisions,
      ).toMatchObject([{ key: "tone" }]);
    });

    it("opens a round and returns a done-proposed session to interviewing without asking the interviewer again, once one-at-a-time can serve an existing frontier decision", async () => {
      const session = await aSession({ answeringMode: "one-at-a-time" });
      const now = new Date().toISOString();
      await getDb().insert(schema.decisions).values({
        id: "decision-tone",
        sessionId: session.id,
        key: "tone",
        questionTitle: "How blunt should it be?",
        dependsOnJson: "[]",
        createdAt: now,
        updatedAt: now,
      });
      await getDb()
        .update(schema.sessions)
        .set({
          state: "done-proposed",
          doneSummary: "Nothing left, we thought.",
        })
        .where(eq(schema.sessions.id, session.id));
      const interviewer = scriptInterviewer([]);

      const result = await requestNextRound.run({ sessionId: session.id });

      expect(interviewer.requests).toHaveLength(0);
      expect(result.round?.decisions.map((card) => card.key)).toEqual([
        "tone",
      ]);
      expect(result.state).toBe("interviewing");
      expect(result.doneSummary).toBeNull();
    });

    it("marks an existing spec not current when a round opens on a confirmed session", async () => {
      const session = await aSession({ answeringMode: "one-at-a-time" });
      const now = new Date().toISOString();
      await getDb().insert(schema.decisions).values({
        id: "decision-tone",
        sessionId: session.id,
        key: "tone",
        questionTitle: "How blunt should it be?",
        dependsOnJson: "[]",
        createdAt: now,
        updatedAt: now,
      });
      await getDb().insert(schema.specs).values({
        id: "spec-1",
        sessionId: session.id,
        markdown: "# Grill Room\n",
        current: true,
        createdAt: now,
        updatedAt: now,
      });
      await getDb()
        .update(schema.sessions)
        .set({ state: "confirmed" })
        .where(eq(schema.sessions.id, session.id));
      scriptInterviewer([]);

      await requestNextRound.run({ sessionId: session.id });

      const [spec] = await getDb()
        .select()
        .from(schema.specs)
        .where(eq(schema.specs.sessionId, session.id));
      expect(spec).toMatchObject({ current: false });
    });
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
      state: "interviewing",
      doneSummary: null,
      turnStatus: "idle",
      turnStartedAt: null,
      turnError: null,
      readiness: null,
      canEditIdea: true,
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

/*
 * Readiness is judged and edited only before the first round, and read back
 * through `get-current-round`, so its actions travel with this file rather than
 * adding another test database to the suite.
 */
describe("idea readiness", () => {
  useTestDatabase();
  afterEach(resetInterviewer);

  function judged(overrides: Parameters<typeof anAssessReadinessResult>[0] = {}) {
    return {
      kind: "assess-readiness" as const,
      result: anAssessReadinessResult(overrides),
    };
  }

  async function setTurnWorking(sessionId: string) {
    await getDb()
      .update(schema.sessions)
      .set({ turnStatus: "working", turnStartedAt: new Date().toISOString() })
      .where(eq(schema.sessions.id, sessionId));
  }

  describe("assess-readiness", () => {
    it("stores the verdict with the idea it judged and returns it", async () => {
      const session = await aSession();
      const interviewer = scriptInterviewer([
        judged({ verdict: "not-ready", missing: ["A buildable objective"] }),
      ]);

      const { readiness } = await assessReadiness.run({ sessionId: session.id });

      expect(readiness).toMatchObject({
        ideaJudged: session.idea,
        result: { verdict: "not-ready", missing: ["A buildable objective"] },
      });
      expect(readiness?.judgedAt).toBeTruthy();
      expect(interviewer.requests[0]).toMatchObject({
        kind: "assess-readiness",
        rejectionReason: null,
        context: {
          idea: session.idea,
          conversationId: null,
          decisions: [],
        },
      });
      expect(
        (await getCurrentRound.run({ sessionId: session.id })).readiness,
      ).toEqual(readiness);
    });

    it("leaves the interview's conversation and model untouched", async () => {
      const session = await aSession();
      scriptInterviewer([{ ...judged(), conversationId: "judge-conversation" }]);

      await assessReadiness.run({ sessionId: session.id });

      expect(await getSession.run({ id: session.id })).toMatchObject({
        conversationId: null,
        modelLocked: false,
        turnStatus: "idle",
      });
    });

    it("refuses once the session has a round", async () => {
      const session = await aSession();
      scriptInterviewer([round(proposed())]);
      await requestNextRound.run({ sessionId: session.id });

      await expect(
        assessReadiness.run({ sessionId: session.id }),
      ).rejects.toMatchObject({ errorCode: "has-rounds" });
    });

    it("refuses while a turn is working", async () => {
      const session = await aSession();
      await setTurnWorking(session.id);

      await expect(
        assessReadiness.run({ sessionId: session.id }),
      ).rejects.toMatchObject({ errorCode: "turn-working" });
    });

    it("refuses a session that is not interviewing", async () => {
      const session = await aSession();
      await getDb()
        .update(schema.sessions)
        .set({ state: "done-proposed" })
        .where(eq(schema.sessions.id, session.id));

      await expect(
        assessReadiness.run({ sessionId: session.id }),
      ).rejects.toMatchObject({ errorCode: "wrong-session-state" });
    });

    it("sends back a ready verdict that contradicts its own findings", async () => {
      const session = await aSession();
      const interviewer = scriptInterviewer([
        judged({ evidence: [], objectiveIsProcess: true }),
        judged({ evidence: [], objectiveIsProcess: true, verdict: "not-ready" }),
      ]);

      const { readiness } = await assessReadiness.run({ sessionId: session.id });

      expect(readiness?.result.verdict).toBe("not-ready");
      expect(interviewer.requests[1]?.rejectionReason).toMatch(
        /at least one evidence item.*not a process/,
      );
    });

    it("sends back a ready verdict whose only evidence restates the objective", async () => {
      const session = await aSession();
      const interviewer = scriptInterviewer([
        judged({
          evidence: [
            ideaEvidence(
              "A local app that grills me about an idea until it is decided",
            ),
          ],
          objective: "A local app that grills me about an idea until it is decided.",
        }),
        judged({ verdict: "not-ready" }),
      ]);

      const { readiness } = await assessReadiness.run({ sessionId: session.id });

      expect(readiness?.result.verdict).toBe("not-ready");
      expect(interviewer.requests[1]?.rejectionReason).toMatch(
        /restates the idea's goal/,
      );
    });

    it("sends back a ready verdict whose only evidence is the whole idea, quoted verbatim", async () => {
      const session = await aSession();
      const interviewer = scriptInterviewer([
        judged({
          evidence: [ideaEvidence(session.idea)],
          objective: "A book tracking app.",
        }),
        judged({ verdict: "not-ready" }),
      ]);

      const { readiness } = await assessReadiness.run({ sessionId: session.id });

      expect(readiness?.result.verdict).toBe("not-ready");
      expect(interviewer.requests[1]?.rejectionReason).toMatch(
        /restates the idea's goal/,
      );
    });

    it("fails the turn once every attempt contradicts itself, storing nothing", async () => {
      const session = await aSession();
      const tooManyUnknowns = judged({
        unknowns: ["a", "b", "c", "d", "e", "f"],
      });
      scriptInterviewer([tooManyUnknowns, tooManyUnknowns, tooManyUnknowns]);

      await expect(
        assessReadiness.run({ sessionId: session.id }),
      ).rejects.toMatchObject({ errorCode: "invalid-readiness" });

      expect(await getCurrentRound.run({ sessionId: session.id })).toMatchObject(
        {
          turnStatus: "failed",
          turnError: { code: "invalid-readiness" },
          readiness: null,
        },
      );
    });

    it("fails the turn when every attempt's evidence only restates the idea, storing nothing", async () => {
      const session = await aSession();
      const restatedOnly = judged({
        evidence: [ideaEvidence(session.idea)],
        objective: "A book tracking app.",
      });
      scriptInterviewer([restatedOnly, restatedOnly, restatedOnly]);

      await expect(
        assessReadiness.run({ sessionId: session.id }),
      ).rejects.toMatchObject({ errorCode: "invalid-readiness" });

      expect(await getCurrentRound.run({ sessionId: session.id })).toMatchObject(
        {
          turnStatus: "failed",
          turnError: { code: "invalid-readiness" },
          readiness: null,
        },
      );
    });

    it("records an interviewer failure on the turn", async () => {
      const session = await aSession();
      scriptInterviewer([
        {
          kind: "assess-readiness",
          error: new InterviewerError("rate-limited", "Limit reached."),
        },
      ]);

      await expect(
        assessReadiness.run({ sessionId: session.id }),
      ).rejects.toMatchObject({ errorCode: "rate-limited" });

      expect(await getSession.run({ id: session.id })).toMatchObject({
        turnStatus: "failed",
        turnErrorCode: "rate-limited",
        readinessJson: null,
      });
    });

    describe("turn records", () => {
      it("records a clean judgment as one successful attempt, on the session's model, linked to the session", async () => {
        const session = await aSession();
        scriptInterviewer([judged()]);

        await assessReadiness.run({ sessionId: session.id });

        const latest = await findLatestTurn({
          sessionId: session.id,
          turnKind: "assess-readiness",
        });
        expect(latest).not.toBeNull();
        const turn = await getTurn.run({ turnId: latest!.id });
        expect(turn).toMatchObject({
          sessionId: session.id,
          turnKind: "assess-readiness",
          model: session.model,
          outcome: "succeeded",
        });
        expect(turn.runs).toHaveLength(1);
        expect(turn.runs[0]!.attempts).toEqual([
          expect.objectContaining({ attemptNumber: 1, kind: "success" }),
        ]);
        expect(
          (await getSession.run({ id: session.id })).readinessTurnId,
        ).toBe(turn.id);
      });

      it("keeps no turn linked once retries are exhausted", async () => {
        const session = await aSession();
        const tooManyUnknowns = judged({
          unknowns: ["a", "b", "c", "d", "e", "f"],
        });
        scriptInterviewer([tooManyUnknowns, tooManyUnknowns, tooManyUnknowns]);

        await expect(
          assessReadiness.run({ sessionId: session.id }),
        ).rejects.toMatchObject({ errorCode: "invalid-readiness" });

        const latest = await findLatestTurn({
          sessionId: session.id,
          turnKind: "assess-readiness",
        });
        expect(latest).not.toBeNull();
        expect(latest!.outcome).toBe("invalid-readiness");
        expect(
          (await getSession.run({ id: session.id })).readinessTurnId,
        ).toBeNull();
      });
    });
  });

  describe("assess-readiness with a project", () => {
    it("runs the scout, then the judge, when there is no current report", async () => {
      const { session } = await aSessionWithProject();
      const interviewer = scriptInterviewer([
        { kind: "scout-project", result: aScoutProjectResult() },
        judged(),
      ]);

      const { readiness } = await assessReadiness.run({ sessionId: session.id });

      expect(interviewer.requests.map((request) => request.kind)).toEqual([
        "scout-project",
        "assess-readiness",
      ]);
      const judgeRequest = interviewer.requests[1]!;
      expect(judgeRequest.kind).toBe("assess-readiness");
      expect(judgeRequest).toMatchObject({
        scoutReport: {
          stale: false,
          proposedDecisions: [
            expect.objectContaining({
              key: "no-message-broker",
              disposition: "undecided",
            }),
          ],
        },
      });

      const { report } = await getScoutReport.run({ sessionId: session.id });
      expect(readiness?.scoutReportId).toBe(report!.id);

      expect(
        await findLatestTurn({ sessionId: session.id, turnKind: "scout-project" }),
      ).not.toBeNull();
      expect(
        await findLatestTurn({ sessionId: session.id, turnKind: "assess-readiness" }),
      ).not.toBeNull();
    });

    it("runs only the judge when a current report already exists", async () => {
      const { session } = await aSessionWithProject();
      scriptInterviewer([{ kind: "scout-project", result: aScoutProjectResult() }]);
      await scoutProject.run({ sessionId: session.id });
      const { report: existingReport } = await getScoutReport.run({
        sessionId: session.id,
      });

      const interviewer = scriptInterviewer([judged()]);
      const { readiness } = await assessReadiness.run({ sessionId: session.id });

      expect(interviewer.requests).toHaveLength(1);
      expect(interviewer.requests[0]?.kind).toBe("assess-readiness");
      expect(readiness?.scoutReportId).toBe(existingReport!.id);
    });

    it("refuses repo evidence whose citation does not resolve in the project, and asks again", async () => {
      const { session } = await aSessionWithProject();
      const interviewer = scriptInterviewer([
        { kind: "scout-project", result: aScoutProjectResult() },
        judged({
          evidence: [
            repoEvidence("Ingest runs on a queue.", "docs/missing.md:1"),
          ],
        }),
        judged(),
      ]);

      await assessReadiness.run({ sessionId: session.id });

      const judgeRequests = interviewer.requests.filter(
        (request) => request.kind === "assess-readiness",
      );
      expect(judgeRequests).toHaveLength(2);
      expect((judgeRequests[1] as { rejectionReason: string | null }).rejectionReason).toMatch(
        /does not exist in the project/,
      );
    });

    it("does not flag a repo evidence item that echoes the objective, only idea items", async () => {
      const { session } = await aSessionWithProject();
      const interviewer = scriptInterviewer([
        { kind: "scout-project", result: aScoutProjectResult() },
        judged({
          evidence: [
            repoEvidence(session.idea, "docs/adr/0003-queue.md:1-2"),
          ],
          objective: session.idea,
          objectiveIsProcess: false,
          unknowns: [],
        }),
      ]);

      const { readiness } = await assessReadiness.run({ sessionId: session.id });

      expect(readiness?.result.verdict).toBe("ready");
      expect(
        interviewer.requests.filter((request) => request.kind === "assess-readiness"),
      ).toHaveLength(1);
    });
  });

  describe("update-session-idea", () => {
    it("trims and stores the idea, clears readiness, and bumps activity", async () => {
      const session = await aSession();
      scriptInterviewer([judged()]);
      await assessReadiness.run({ sessionId: session.id });
      await getDb()
        .update(schema.sessions)
        .set({ updatedAt: "2024-01-01T00:00:00.000Z" })
        .where(eq(schema.sessions.id, session.id));

      const updated = await updateSessionIdea.run({
        sessionId: session.id,
        idea: "  Build a readiness judge for ideas.  ",
      });

      expect(updated).toMatchObject({
        idea: "Build a readiness judge for ideas.",
        readinessJson: null,
      });
      expect(updated?.updatedAt > "2024-01-01T00:00:00.000Z").toBe(true);
      expect(
        (await getCurrentRound.run({ sessionId: session.id })).readiness,
      ).toBeNull();
    });

    it("refuses an empty idea", async () => {
      const session = await aSession();

      await expect(
        updateSessionIdea.run({ sessionId: session.id, idea: "   " }),
      ).rejects.toMatchObject({ errorCode: "idea-required" });
    });

    it("refuses once the session has a round", async () => {
      const session = await aSession();
      scriptInterviewer([round(proposed())]);
      await requestNextRound.run({ sessionId: session.id });

      await expect(
        updateSessionIdea.run({ sessionId: session.id, idea: "Another idea" }),
      ).rejects.toMatchObject({ errorCode: "has-rounds" });
    });

    it("refuses while a turn is working", async () => {
      const session = await aSession();
      await setTurnWorking(session.id);

      await expect(
        updateSessionIdea.run({ sessionId: session.id, idea: "Another idea" }),
      ).rejects.toMatchObject({ errorCode: "turn-working" });
    });
  });

  describe("reading readiness back", () => {
    it("reads a judgment of an earlier idea as absent", async () => {
      const session = await aSession();
      scriptInterviewer([judged()]);
      await assessReadiness.run({ sessionId: session.id });
      await getDb()
        .update(schema.sessions)
        .set({ idea: "An idea changed behind the judgment's back" })
        .where(eq(schema.sessions.id, session.id));

      expect(
        (await getCurrentRound.run({ sessionId: session.id })).readiness,
      ).toBeNull();
    });

    it("a judgment goes stale when its report does", async () => {
      const { session } = await aSessionWithProject();
      scriptInterviewer([
        { kind: "scout-project", result: aScoutProjectResult() },
        judged(),
      ]);
      await assessReadiness.run({ sessionId: session.id });

      expect(
        (await getCurrentRound.run({ sessionId: session.id })).readiness,
      ).not.toBeNull();

      // A re-run replaces the report the judgment was made from. It must
      // account for the previous report's decision to be accepted.
      scriptInterviewer([
        {
          kind: "scout-project",
          result: aScoutProjectResult({
            previousDecisions: [
              { key: "no-message-broker", change: "unchanged", statement: null },
            ],
          }),
        },
      ]);
      await scoutProject.run({ sessionId: session.id });

      expect(
        (await getCurrentRound.run({ sessionId: session.id })).readiness,
      ).toBeNull();
    });

    it("reads an old stored judgment, from before evidence carried a source", async () => {
      const session = await aSession();
      const legacy = {
        ideaJudged: session.idea,
        judgedAt: "2026-01-01T00:00:00.000Z",
        result: {
          evidence: ["A fact from before evidence had a source"],
          objective: "A local app that interviews the user until an idea is decided.",
          objectiveIsProcess: false,
          expectedOutcome: "A settled set of decisions for the idea.",
          unknowns: [],
          verdict: "ready",
          missing: [],
        },
      };
      await getDb()
        .update(schema.sessions)
        .set({ readinessJson: JSON.stringify(legacy) })
        .where(eq(schema.sessions.id, session.id));

      const readiness = (await getCurrentRound.run({ sessionId: session.id }))
        .readiness;
      expect(readiness).toMatchObject({
        scoutReportId: null,
        result: {
          evidence: [
            {
              text: "A fact from before evidence had a source",
              source: "idea",
              citation: null,
            },
          ],
        },
      });
    });

    it("lets the idea be edited only before the first round and while idle", async () => {
      const session = await aSession();
      const canEdit = async () =>
        (await getCurrentRound.run({ sessionId: session.id })).canEditIdea;

      expect(await canEdit()).toBe(true);

      await setTurnWorking(session.id);
      expect(await canEdit()).toBe(false);

      await getDb()
        .update(schema.sessions)
        .set({ turnStatus: "idle" })
        .where(eq(schema.sessions.id, session.id));
      scriptInterviewer([round(proposed())]);
      await requestNextRound.run({ sessionId: session.id });
      expect(await canEdit()).toBe(false);
    });
  });
});

describe("propose-round turn records", () => {
  useTestDatabase();
  afterEach(resetInterviewer);

  /** The session's latest propose-round turn, read back through `get-turn`. */
  async function proposalTurn(sessionId: string) {
    const latest = await findLatestTurn({
      sessionId,
      turnKind: "propose-round",
    });
    expect(latest).not.toBeNull();
    return getTurn.run({ turnId: latest!.id });
  }

  async function onlyRunAttempts(sessionId: string) {
    const turn = await proposalTurn(sessionId);
    expect(turn.runs).toHaveLength(1);
    return turn.runs[0]!.attempts;
  }

  async function roundTurnIds(sessionId: string) {
    const rows = await getDb()
      .select()
      .from(schema.rounds)
      .where(eq(schema.rounds.sessionId, sessionId));
    return rows.map((row) => row.turnId);
  }

  /** The session already has a conversation, so the next turn resumes it. */
  async function withConversation(sessionId: string) {
    await getDb()
      .update(schema.sessions)
      .set({ conversationId: "earlier-conversation" })
      .where(eq(schema.sessions.id, sessionId));
  }

  const offFrontier = () => ({
    kind: "propose-round" as const,
    result: treeRuleViolation.offFrontier(),
  });
  const unknownKey = () => ({
    kind: "propose-round" as const,
    result: treeRuleViolation.unknownKey(),
  });

  it("records a clean turn as exactly one successful attempt, on the session's model, linked to its round", async () => {
    const session = await aSession();
    const clean = round(proposed({ key: "shape" }));
    scriptInterviewer([clean]);

    await requestNextRound.run({ sessionId: session.id });

    const turn = await proposalTurn(session.id);
    expect(turn).toMatchObject({
      sessionId: session.id,
      turnKind: "propose-round",
      model: "sonnet",
      outcome: "succeeded",
    });
    expect(turn.completedAt).not.toBeNull();
    expect(turn.totalElapsedMs).toBeGreaterThanOrEqual(0);
    expect(turn.runs).toHaveLength(1);
    expect(turn.runs[0]).toMatchObject({ runNumber: 1, manualRetry: false });
    expect(turn.runs[0]!.attempts).toEqual([
      expect.objectContaining({
        attemptNumber: 1,
        kind: "success",
        reason: null,
        rawOutput: JSON.stringify(clean.result),
      }),
    ]);
    expect(turn.runs[0]!.attempts[0]!.durationMs).toBeGreaterThanOrEqual(0);
    expect(await roundTurnIds(session.id)).toEqual([turn.id]);
  });

  it("exposes the round's turn id through get-current-round and list-rounds, and the live turn through get-latest-turn", async () => {
    const session = await aSession();
    scriptInterviewer([
      round(proposed({ key: "shape" })),
      round(proposed({ key: "tone", title: "How blunt should it be?" })),
    ]);

    const opened = await requestNextRound.run({ sessionId: session.id });
    const turn = await proposalTurn(session.id);
    expect(opened.round?.turnId).toBe(turn.id);
    expect(
      await getLatestTurn.run({ sessionId: session.id, turnKind: "propose-round" }),
    ).toMatchObject({ id: turn.id });

    await saveDraftAnswer.run({
      decisionId: opened.round!.decisions[0]!.id,
      answerKind: "accepted-recommendation",
    });
    await submitRound.run({ id: opened.round!.id });

    const history = await listRounds.run({ sessionId: session.id });
    expect(history.rounds[0]?.turnId).toBe(turn.id);
  });

  it("reads no turn from get-latest-turn for a kind the session has never run", async () => {
    const session = await aSession();

    expect(
      await getLatestTurn.run({ sessionId: session.id, turnKind: "propose-round" }),
    ).toBeNull();
  });

  it("records each refusal as its own attempt with the reason sent back, then the success, numbered upward", async () => {
    const session = await aSession();
    const first = offFrontier();
    const second = unknownKey();
    const accepted = round(proposed({ key: "shape" }));
    const interviewer = scriptInterviewer([first, second, accepted]);

    await requestNextRound.run({ sessionId: session.id });

    const attempts = await onlyRunAttempts(session.id);
    expect(
      attempts.map(({ attemptNumber, kind }) => ({ attemptNumber, kind })),
    ).toEqual([
      { attemptNumber: 1, kind: "tree-rule-refusal" },
      { attemptNumber: 2, kind: "tree-rule-refusal" },
      { attemptNumber: 3, kind: "success" },
    ]);
    expect(attempts[0]!.reason).toBe(
      (interviewer.requests[1] as { rejectionReason: string | null })
        .rejectionReason,
    );
    expect(attempts[0]!.reason).toContain("not on the frontier");
    expect(attempts[1]!.reason).toBe(
      (interviewer.requests[2] as { rejectionReason: string | null })
        .rejectionReason,
    );
    expect(attempts[1]!.reason).toContain("fake-no-such-decision");
    expect(attempts[2]!.reason).toBeNull();
    expect(attempts.map((attempt) => attempt.rawOutput)).toEqual([
      JSON.stringify(first.result),
      JSON.stringify(second.result),
      JSON.stringify(accepted.result),
    ]);
    const turn = await proposalTurn(session.id);
    expect(turn.outcome).toBe("succeeded");
    expect(await roundTurnIds(session.id)).toEqual([turn.id]);
  });

  it("stops a turn whose budget is spent and keeps every attempt", async () => {
    const session = await aSession();
    const interviewer = scriptInterviewer([
      offFrontier(),
      offFrontier(),
      offFrontier(),
    ]);

    const failure = await Promise.resolve(
      requestNextRound.run({ sessionId: session.id }),
    ).then(
      () => null,
      (error: Error) => error,
    );

    expect(failure).toBeInstanceOf(Error);
    expect(interviewer.requests).toHaveLength(3);
    const turn = await proposalTurn(session.id);
    expect(turn.outcome).toBe("invalid-proposal");
    expect(turn.completedAt).not.toBeNull();
    const attempts = turn.runs[0]!.attempts;
    expect(attempts.map((attempt) => attempt.kind)).toEqual([
      "tree-rule-refusal",
      "tree-rule-refusal",
      "tree-rule-refusal",
    ]);
    expect(attempts.every((attempt) => attempt.rawOutput != null)).toBe(true);
    expect(failure!.message).toContain(`Last reason: ${attempts[2]!.reason}`);
    expect(await getSession.run({ id: session.id })).toMatchObject({
      turnStatus: "failed",
      turnErrorCode: "invalid-proposal",
    });
  });

  it("records a resume fallback as its own attempt with no output", async () => {
    const session = await aSession();
    await withConversation(session.id);
    scriptInterviewer([
      withResumeFallback(
        round(proposed({ key: "shape" })),
        "No conversation found.",
      ),
    ]);

    await requestNextRound.run({ sessionId: session.id });

    expect(await onlyRunAttempts(session.id)).toEqual([
      expect.objectContaining({
        attemptNumber: 1,
        kind: "resume-fallback",
        reason: "No conversation found.",
        rawOutput: null,
      }),
      expect.objectContaining({ attemptNumber: 2, kind: "success" }),
    ]);
  });

  it("does not spend the rejection budget on a resume fallback", async () => {
    const session = await aSession();
    await withConversation(session.id);
    const interviewer = scriptInterviewer([
      withResumeFallback(offFrontier()),
      offFrontier(),
      round(proposed({ key: "shape" })),
    ]);

    await requestNextRound.run({ sessionId: session.id });

    expect(interviewer.requests).toHaveLength(3);
    const turn = await proposalTurn(session.id);
    expect(turn.outcome).toBe("succeeded");
    expect(turn.runs[0]!.attempts.map((attempt) => attempt.kind)).toEqual([
      "resume-fallback",
      "tree-rule-refusal",
      "tree-rule-refusal",
      "success",
    ]);
  });

  it("stops the turn on schema-invalid output with its own kind and the raw output, without retrying", async () => {
    const session = await aSession();
    const invalid = schemaInvalidTurn("propose-round", {
      proposedDecisions: "nope",
    });
    const interviewer = scriptInterviewer([offFrontier(), invalid]);

    await expect(
      requestNextRound.run({ sessionId: session.id }),
    ).rejects.toThrow(/does not match the expected shape/);

    expect(interviewer.requests).toHaveLength(2);
    const turn = await proposalTurn(session.id);
    expect(turn.outcome).toBe("malformed-output");
    const attempts = turn.runs[0]!.attempts;
    expect(attempts.map((attempt) => attempt.kind)).toEqual([
      "tree-rule-refusal",
      "schema-invalid",
    ]);
    expect(attempts[1]!.reason).toMatch(/Schema mismatch at proposedDecisions/);
    expect(attempts[1]!.rawOutput).toBe(JSON.stringify(invalid.invalidResult));
    expect(await roundTurnIds(session.id)).toEqual([]);
  });

  it("stops the turn on a rate limit with its own kind, distinct from an interviewer error", async () => {
    const session = await aSession();
    scriptInterviewer([
      rateLimitedTurn("propose-round", "The subscription pool is spent."),
    ]);

    await expect(
      requestNextRound.run({ sessionId: session.id }),
    ).rejects.toThrow("The subscription pool is spent.");

    const rateLimited = await proposalTurn(session.id);
    expect(rateLimited.outcome).toBe("rate-limited");
    expect(rateLimited.runs[0]!.attempts).toEqual([
      expect.objectContaining({
        attemptNumber: 1,
        kind: "rate-limit",
        reason: "The subscription pool is spent.",
        rawOutput: null,
      }),
    ]);

    // A fresh session, not a retry on the rate-limited one above: this is
    // checking that an interviewer error's attempt kind is distinct from a
    // rate limit's, not exercising the manual-retry continuation (covered in
    // "manual retry" below).
    const otherSession = await aSession();
    scriptInterviewer([
      {
        kind: "propose-round",
        error: new InterviewerError("failed", "The turn died."),
      },
    ]);
    await expect(
      requestNextRound.run({ sessionId: otherSession.id }),
    ).rejects.toThrow("The turn died.");

    const errored = await proposalTurn(otherSession.id);
    expect(errored.id).not.toBe(rateLimited.id);
    expect(errored.outcome).toBe("failed");
    expect(errored.runs[0]!.attempts).toEqual([
      expect.objectContaining({
        kind: "error",
        reason: "failed: The turn died.",
        rawOutput: null,
      }),
    ]);
    expect(errored.runs[0]!.attempts[0]!.durationMs).not.toBeNull();
  });

  it("lets the attempts be read back while the turn is still running", async () => {
    const session = await aSession();
    const fake = scriptInterviewer([
      offFrontier(),
      round(proposed({ key: "shape" })),
    ]);
    const seenMidTurn: Awaited<ReturnType<typeof proposalTurn>>[] = [];
    let calls = 0;
    setInterviewer({
      ...fake,
      proposeRound: (request, observer) =>
        fake.proposeRound(request, {
          ...observer,
          async callStarted(call) {
            await observer?.callStarted?.(call);
            calls += 1;
            if (calls === 2) seenMidTurn.push(await proposalTurn(session.id));
          },
        }),
    });

    await requestNextRound.run({ sessionId: session.id });

    expect(seenMidTurn).toHaveLength(1);
    const [midTurn] = seenMidTurn;
    expect(midTurn!.outcome).toBeNull();
    expect(midTurn!.completedAt).toBeNull();
    expect(midTurn!.runs[0]!.attempts).toEqual([
      expect.objectContaining({ attemptNumber: 1, kind: "tree-rule-refusal" }),
      expect.objectContaining({
        attemptNumber: 2,
        kind: null,
        durationMs: null,
        reason: null,
        rawOutput: null,
      }),
    ]);
    // Only a running attempt has no kind: every completed one carries one.
    const running = midTurn!.runs[0]!.attempts[1]!;
    expect([running.kind, running.durationMs]).toEqual([null, null]);
    expect(
      (await proposalTurn(session.id)).runs[0]!.attempts.map(
        (attempt) => attempt.kind,
      ),
    ).toEqual(["tree-rule-refusal", "success"]);
  });

  it("links no turn to a round served from an earlier proposal's queue", async () => {
    const session = await aSession({ answeringMode: "one-at-a-time" });
    scriptInterviewer([
      round(
        proposed({ key: "shape" }),
        proposed({ key: "tone", title: "How blunt should it be?" }),
      ),
    ]);

    const first = await requestNextRound.run({ sessionId: session.id });
    await saveDraftAnswer.run({
      decisionId: first.round!.decisions[0]!.id,
      answerKind: "accepted-recommendation",
    });
    await submitRound.run({ id: first.round!.id });

    const turn = await proposalTurn(session.id);
    const linked = await roundTurnIds(session.id);
    expect(linked).toHaveLength(2);
    expect(linked).toContain(turn.id);
    expect(linked).toContain(null);
  });
});

describe("propose-round manual retry", () => {
  useTestDatabase();
  afterEach(resetInterviewer);

  /** The session's latest propose-round turn, read back through `get-turn`. */
  async function proposalTurn(sessionId: string) {
    const latest = await findLatestTurn({
      sessionId,
      turnKind: "propose-round",
    });
    expect(latest).not.toBeNull();
    return getTurn.run({ turnId: latest!.id });
  }

  async function roundTurnIds(sessionId: string) {
    const rows = await getDb()
      .select()
      .from(schema.rounds)
      .where(eq(schema.rounds.sessionId, sessionId));
    return rows.map((row) => row.turnId);
  }

  const offFrontier = () => ({
    kind: "propose-round" as const,
    result: treeRuleViolation.offFrontier(),
  });

  it("continues the same turn as a new run after schema-invalid output stopped it", async () => {
    const session = await aSession();
    const invalid = schemaInvalidTurn("propose-round", {
      proposedDecisions: "nope",
    });
    scriptInterviewer([invalid]);
    await expect(
      requestNextRound.run({ sessionId: session.id }),
    ).rejects.toThrow();

    const stopped = await proposalTurn(session.id);
    expect(stopped.outcome).toBe("malformed-output");
    expect(stopped.runs).toHaveLength(1);

    scriptInterviewer([round(proposed({ key: "shape" }))]);
    await requestNextRound.run({ sessionId: session.id });

    const retried = await proposalTurn(session.id);
    expect(retried.id).toBe(stopped.id);
    expect(retried.outcome).toBe("succeeded");
    expect(retried.runs).toHaveLength(2);
    expect(retried.runs[0]).toMatchObject({ runNumber: 1, manualRetry: false });
    expect(retried.runs[1]).toMatchObject({ runNumber: 2, manualRetry: true });
    expect(retried.runs[1]!.attempts).toEqual([
      expect.objectContaining({ attemptNumber: 1, kind: "success" }),
    ]);
    expect(retried.totalElapsedMs).toBeGreaterThanOrEqual(
      stopped.totalElapsedMs ?? 0,
    );
    expect(await roundTurnIds(session.id)).toEqual([retried.id]);
  });

  it("continues the same turn as a new run after a rate limit stopped it", async () => {
    const session = await aSession();
    scriptInterviewer([
      rateLimitedTurn("propose-round", "The subscription pool is spent."),
    ]);
    await expect(
      requestNextRound.run({ sessionId: session.id }),
    ).rejects.toThrow("The subscription pool is spent.");

    const stopped = await proposalTurn(session.id);
    expect(stopped.outcome).toBe("rate-limited");
    expect(stopped.runs).toHaveLength(1);

    scriptInterviewer([round(proposed({ key: "shape" }))]);
    await requestNextRound.run({ sessionId: session.id });

    const retried = await proposalTurn(session.id);
    expect(retried.id).toBe(stopped.id);
    expect(retried.outcome).toBe("succeeded");
    expect(retried.runs).toHaveLength(2);
    expect(retried.runs[1]).toMatchObject({ runNumber: 2, manualRetry: true });
    expect(retried.runs[1]!.attempts).toEqual([
      expect.objectContaining({ attemptNumber: 1, kind: "success" }),
    ]);
  });

  it("continues the same turn as a new run after an exhausted budget stopped it, the budget counter restarting at 1", async () => {
    const session = await aSession();
    scriptInterviewer([offFrontier(), offFrontier(), offFrontier()]);
    await expect(
      requestNextRound.run({ sessionId: session.id }),
    ).rejects.toThrow();

    const stopped = await proposalTurn(session.id);
    expect(stopped.outcome).toBe("invalid-proposal");
    expect(stopped.runs[0]!.attempts).toHaveLength(3);

    // One more refusal inside the retried run: were the budget not reset,
    // this alone would exhaust it (it would be the fourth in a row).
    scriptInterviewer([offFrontier(), round(proposed({ key: "shape" }))]);
    await requestNextRound.run({ sessionId: session.id });

    const retried = await proposalTurn(session.id);
    expect(retried.id).toBe(stopped.id);
    expect(retried.outcome).toBe("succeeded");
    expect(retried.runs).toHaveLength(2);
    expect(retried.runs[1]).toMatchObject({ runNumber: 2, manualRetry: true });
    expect(
      retried.runs[1]!.attempts.map(({ attemptNumber, kind }) => ({
        attemptNumber,
        kind,
      })),
    ).toEqual([
      { attemptNumber: 1, kind: "tree-rule-refusal" },
      { attemptNumber: 2, kind: "success" },
    ]);
    expect(await roundTurnIds(session.id)).toEqual([retried.id]);
  });

  it("keeps a single run on a stopped turn that is never retried", async () => {
    const session = await aSession();
    scriptInterviewer([
      rateLimitedTurn("propose-round", "The subscription pool is spent."),
    ]);
    await expect(
      requestNextRound.run({ sessionId: session.id }),
    ).rejects.toThrow();

    const stopped = await proposalTurn(session.id);
    expect(stopped.runs).toHaveLength(1);
    expect(stopped.runs[0]).toMatchObject({ runNumber: 1, manualRetry: false });
  });

  it("starts a new turn once a turn of the kind has succeeded, even though an earlier one of the kind once stopped", async () => {
    const session = await aSession();
    scriptInterviewer([offFrontier(), offFrontier(), offFrontier()]);
    await expect(
      requestNextRound.run({ sessionId: session.id }),
    ).rejects.toThrow();
    const stopped = await proposalTurn(session.id);

    // A manual retry succeeds: same turn, second run.
    scriptInterviewer([round(proposed({ key: "shape" }))]);
    const afterRetry = await requestNextRound.run({ sessionId: session.id });
    const succeeded = await proposalTurn(session.id);
    expect(succeeded.id).toBe(stopped.id);
    expect(succeeded.outcome).toBe("succeeded");

    // Submitting settles the round and asks for the next proposal itself.
    // The session's turn is idle now, not failed, so this is a genuinely
    // fresh call rather than a retry — a new turn record, not a third run.
    scriptInterviewer([
      round(proposed({ key: "tone", title: "How blunt should it be?" })),
    ]);
    await saveDraftAnswer.run({
      decisionId: afterRetry.round!.decisions[0]!.id,
      answerKind: "accepted-recommendation",
    });
    await submitRound.run({ id: afterRetry.round!.id });

    const fresh = await proposalTurn(session.id);
    expect(fresh.id).not.toBe(succeeded.id);
    expect(fresh.runs).toHaveLength(1);
    expect(fresh.runs[0]).toMatchObject({ runNumber: 1, manualRetry: false });
  });

  it("does not join a stopped turn of a different kind that is not what left the session failed", async () => {
    const session = await aSession();

    // A turn of another kind — a stale review, say — stops and is never
    // retried. `review-stale` is not yet wired to a real action (that is a
    // separate ticket), so it is driven directly through `runTurn`, exactly
    // as the real caller will once it is.
    await expect(
      runTurn({
        sessionId: session.id,
        failedMessage: "The review turn failed.",
        record: { turnKind: "review-stale", model: "sonnet" },
        take: async () => {
          throw new TurnRejected(
            "invalid-review",
            "The review ruled on a decision outside the batch.",
          );
        },
      }),
    ).rejects.toThrow();

    const staleReviewTurn = await findLatestTurn({
      sessionId: session.id,
      turnKind: "review-stale",
    });
    expect(staleReviewTurn?.outcome).toBe("invalid-review");
    expect(staleReviewTurn?.runs).toHaveLength(1);

    // Later, a round proposal fails too. The session's turn is `"failed"`
    // again, but this time propose-round — not review-stale — is what left
    // it that way: propose-round is now the session's latest turn of any
    // kind.
    scriptInterviewer([offFrontier(), offFrontier(), offFrontier()]);
    await expect(
      requestNextRound.run({ sessionId: session.id }),
    ).rejects.toThrow();

    const proposeRoundTurn = await proposalTurn(session.id);
    expect(proposeRoundTurn.outcome).toBe("invalid-proposal");

    // The user reopens a decision, which runs a fresh review-stale turn. It
    // must not join the old, hours-old-in-spirit stopped review-stale turn
    // above — that turn is not what left the session failed.
    await runTurn({
      sessionId: session.id,
      failedMessage: "The review turn failed.",
      record: { turnKind: "review-stale", model: "sonnet" },
      take: async () => null,
    });

    const freshStaleReviewTurn = await findLatestTurn({
      sessionId: session.id,
      turnKind: "review-stale",
    });
    expect(freshStaleReviewTurn?.id).not.toBe(staleReviewTurn?.id);
    expect(freshStaleReviewTurn?.runs).toHaveLength(1);
    expect(freshStaleReviewTurn?.runs[0]).toMatchObject({
      runNumber: 1,
      manualRetry: false,
    });
    expect(freshStaleReviewTurn?.outcome).toBe("succeeded");
  });
});
