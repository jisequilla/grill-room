import { eq } from "@agent-native/core/db/schema";
import { afterEach, describe, expect, it } from "vitest";

import { InterviewerError } from "../server/interviewer/errors.js";
import {
  resetInterviewer,
  scriptInterviewer,
  setInterviewer,
  type FakeInterviewer,
  type Interviewer,
  type ProposeRoundRequest,
  type ScriptedTurn,
} from "../server/interviewer/index.js";
import type { BatchProgress } from "../server/reopen-batch.js";
import { getDb, schema, useTestDatabase } from "../test/db.js";
import answerDecision from "./answer-decision.js";
import applyReopenBatch from "./apply-reopen-batch.js";
import createSession from "./create-session.js";
import getCurrentRound from "./get-current-round.js";
import getSession from "./get-session.js";
import getTree from "./get-tree.js";
import requestNextRound from "./request-next-round.js";
import saveDraftAnswer from "./save-draft-answer.js";
import submitRound from "./submit-round.js";

/*
 * A batch of reopens is the orchestrated comparison of
 * `docs/design/session-retrospective.md` (finding 5) as a feature, and its one
 * hard case is the one that session hit: an item's own stale review can re-ask
 * a decision that a later item was going to reopen. By the time the batch
 * reaches it, it is no longer settled, and it has to be answered as a card
 * instead of refused.
 */

function withRationales(labels: readonly string[]) {
  return labels.map((label) => ({ label, rationale: `Why ${label}` }));
}

function proposal(
  ...proposedDecisions: {
    key: string;
    title: string;
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
        choices: [],
        recommendedChoice: null,
        recommendedAnswer: `The usual answer to ${decision.key}`,
        dependsOn: decision.dependsOn ?? [],
        ask: decision.ask ?? true,
      })),
      pushBackResponses: [],
      userDecisionPlacements: [],
      done: null,
    },
  };
}

/** The interviewer's "nothing further" turn. */
const nothingMore = proposal();

function review(
  ...verdicts: {
    key: string;
    verdict: "reconfirm" | "re-ask";
    title?: string;
  }[]
): ScriptedTurn {
  return {
    kind: "review-stale",
    result: {
      reviews: verdicts.map((verdict) => ({
        decisionKey: verdict.key,
        verdict: verdict.verdict,
        reason: `What ${verdict.key} rests on moved.`,
        title: verdict.title ?? null,
        body: null,
        choices: withRationales([]),
        recommendedChoice: null,
        recommendedAnswer: null,
      })),
    },
  };
}

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

/** shape -> storage -> sync, all three settled, each asked in its own round. */
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
    proposal({ key: "sync", title: "How does it sync?", dependsOn: ["storage"] }),
    ...trailing,
  ]);

  await requestNextRound.run({ sessionId: session.id });
  await answerOpenRound(session.id, "A workspace");
  await answerOpenRound(session.id, "On disk");
  await answerOpenRound(session.id, "Poll");

  return { sessionId: session.id, interviewer };
}

async function treeBy(sessionId: string) {
  const tree = await getTree.run({ sessionId });
  return Object.fromEntries(
    tree.decisions.map((decision) => [decision.key, decision]),
  );
}

async function storedProgress(sessionId: string): Promise<string | null> {
  const [row] = await getDb()
    .select({ json: schema.sessions.batchProgressJson })
    .from(schema.sessions)
    .where(eq(schema.sessions.id, sessionId));
  return row?.json ?? null;
}

describe("apply-reopen-batch", () => {
  useTestDatabase();
  afterEach(resetInterviewer);

  it("answers an item its own predecessor's review already re-asked, instead of refusing it", async () => {
    // Item 1 reopens `shape`. The review that follows re-asks `storage` — so by
    // the time item 2 comes around, `storage` is a card of the open round and
    // no longer settled: exactly the case the first real session hit.
    const { sessionId } = await aSettledChain(
      nothingMore,
      review(
        { key: "storage", verdict: "re-ask" },
        { key: "sync", verdict: "reconfirm" },
      ),
      nothingMore,
      nothingMore,
      nothingMore,
    );
    const tree = await treeBy(sessionId);

    const result = await applyReopenBatch.run({
      sessionId,
      items: [
        { decisionKey: "shape", answer: "A page, after all" },
        { decisionKey: "storage", answer: "In the browser" },
        { decisionKey: "sync", answer: "Push" },
      ],
    });

    expect(
      result.outcomes.map((outcome) => [outcome.key, outcome.status]),
    ).toEqual([
      ["shape", "reopened"],
      ["storage", "answered-as-card"],
      ["sync", "reopened"],
    ]);
    expect(result).toMatchObject({ total: 3, completed: 3, failedAt: null });

    const after = await treeBy(sessionId);
    expect(after.shape?.answer).toEqual({
      text: "A page, after all",
      kind: "own-answer",
    });
    expect(after.storage?.answer).toEqual({
      text: "In the browser",
      kind: "own-answer",
    });
    expect(after.sync?.answer).toEqual({ text: "Push", kind: "own-answer" });
    expect(tree.shape?.id).toBe(after.shape?.id);
  });

  it("answers an item that is an open loose end through answer-decision, without a round", async () => {
    const { sessionId, interviewer } = await aSettledChain(nothingMore);
    const sync = (await treeBy(sessionId)).sync!;

    // `sync` becomes a loose end: the user said they did not know.
    await getDb()
      .update(schema.decisions)
      .set({ answerKind: "unknown", currentAnswer: "", settledAt: null })
      .where(eq(schema.decisions.id, sync.id));

    const before = interviewer.requests.length;
    const result = await applyReopenBatch.run({
      sessionId,
      items: [{ decisionKey: "sync", answer: "Poll, every minute" }],
    });

    expect(result.outcomes).toEqual([
      {
        decisionId: sync.id,
        key: "sync",
        title: "How does it sync?",
        status: "answered-as-loose-end",
        state: "frontier",
        error: null,
      },
    ]);
    // Answering a loose end never calls the interviewer.
    expect(interviewer.requests).toHaveLength(before);
    expect((await treeBy(sessionId)).sync?.answer).toEqual({
      text: "Poll, every minute",
      kind: "own-answer",
    });
  });

  it("skips an item that is blocked, and carries on with the rest", async () => {
    const session = await createSession.run({
      title: "Grill Room",
      idea: "A local app that grills me about an idea until it is decided.",
    });
    scriptInterviewer([
      proposal(
        { key: "shape", title: "What shape?" },
        {
          key: "storage",
          title: "Where does the data live?",
          dependsOn: ["shape"],
          ask: false,
        },
      ),
    ]);
    await requestNextRound.run({ sessionId: session.id });

    // `storage` hangs off an unanswered `shape`, so it is blocked: not settled,
    // not a card the round is asking, not a loose end.
    const blocked = (await treeBy(session.id)).storage!;

    const result = await applyReopenBatch.run({
      sessionId: session.id,
      items: [{ decisionKey: "storage", answer: "In the browser" }],
    });

    expect(result.outcomes).toEqual([
      {
        decisionId: blocked.id,
        key: "storage",
        title: "Where does the data live?",
        status: "not-reopenable",
        state: "blocked",
        error: null,
      },
    ]);
    expect(result.failedAt).toBeNull();
    expect((await treeBy(session.id)).storage?.answer).toBeNull();
  });

  it("stops at the first failure, keeps what completed, and clears the progress", async () => {
    const { sessionId } = await aSettledChain(
      nothingMore,
      // Item 1: no dependents of `sync`, so no review — straight to the
      // proposal, which fails.
      {
        kind: "propose-round",
        error: new InterviewerError(
          "rate-limited",
          "The subscription's limit has been reached.",
        ),
      },
    );

    const result = await applyReopenBatch.run({
      sessionId,
      items: [
        { decisionKey: "sync", answer: "Push" },
        { decisionKey: "storage", answer: "In the browser" },
      ],
    });

    expect(result.outcomes.map((outcome) => outcome.status)).toEqual(["failed"]);
    expect(result.outcomes[0]).toMatchObject({
      key: "sync",
      error: {
        code: "rate-limited",
        message: "The subscription's limit has been reached.",
      },
    });
    expect(result).toMatchObject({ total: 2, completed: 1, failedAt: 1 });
    expect(await storedProgress(sessionId)).toBeNull();

    // The second item was never touched.
    expect((await treeBy(sessionId)).storage?.answer).toEqual({
      text: "On disk",
      kind: "own-answer",
    });
  });

  it("refuses while an interviewer turn is working", async () => {
    const { sessionId } = await aSettledChain(nothingMore);
    await getDb()
      .update(schema.sessions)
      .set({ turnStatus: "working", turnStartedAt: new Date().toISOString() })
      .where(eq(schema.sessions.id, sessionId));

    await expect(
      applyReopenBatch.run({
        sessionId,
        items: [{ decisionKey: "shape", answer: "A page" }],
      }),
    ).rejects.toThrow(/interviewer is working/);
  });

  it("refuses while another batch is already running", async () => {
    const { sessionId } = await aSettledChain(nothingMore);
    await getDb()
      .update(schema.sessions)
      .set({
        batchProgressJson: JSON.stringify({
          total: 2,
          completed: 1,
          current: null,
          outcomes: [],
        }),
      })
      .where(eq(schema.sessions.id, sessionId));

    await expect(
      applyReopenBatch.run({
        sessionId,
        items: [{ decisionKey: "shape", answer: "A page" }],
      }),
    ).rejects.toThrow(/batch is already running/);
  });

  it("refuses an item naming a decision the session does not have", async () => {
    const { sessionId } = await aSettledChain(nothingMore);

    await expect(
      applyReopenBatch.run({
        sessionId,
        items: [{ decisionKey: "nonsense", answer: "A page" }],
      }),
    ).rejects.toThrow(/No decision in this session matches key "nonsense"/);
  });

  it("adds the decisions it was given once every item has landed", async () => {
    const { sessionId } = await aSettledChain(nothingMore, nothingMore);

    const result = await applyReopenBatch.run({
      sessionId,
      items: [{ decisionKey: "sync", answer: "Push" }],
      newDecisions: [
        { title: "How do we handle offline use?", body: "From the comparison." },
      ],
    });

    expect(result.added).toEqual([
      { id: expect.any(String), title: "How do we handle offline use?" },
    ]);

    const added = (await getTree.run({ sessionId })).decisions.find(
      (decision) => decision.questionTitle === "How do we handle offline use?",
    );
    expect(added).toMatchObject({ state: "unplaced", introducedBy: "user" });
  });

  it("leaves the decisions it was given unadded when the batch stopped early", async () => {
    const { sessionId } = await aSettledChain(nothingMore, {
      kind: "propose-round",
      error: new InterviewerError("rate-limited", "Limit reached."),
    });

    const result = await applyReopenBatch.run({
      sessionId,
      items: [{ decisionKey: "sync", answer: "Push" }],
      newDecisions: [{ title: "How do we handle offline use?", body: "" }],
    });

    expect(result.failedAt).toBe(1);
    expect(result.added).toEqual([]);
    expect(
      (await getTree.run({ sessionId })).decisions.map(
        (decision) => decision.questionTitle,
      ),
    ).not.toContain("How do we handle offline use?");
  });

  it("records its progress on the session while it runs, so a reload can show it", async () => {
    const { sessionId } = await aSettledChain(nothingMore, nothingMore);
    const sync = (await treeBy(sessionId)).sync!;
    const seen: (BatchProgress | null)[] = [];

    // The interviewer is the only thing that runs mid-batch, so it is where
    // the progress can be read while the batch still holds the turn.
    const scripted = scriptInterviewer([]);
    const watching: Interviewer = {
      ...scripted,
      proposeRound: async (request: ProposeRoundRequest) => {
        const session = await getSession.run({ id: sessionId });
        seen.push(
          session.batchProgressJson
            ? (JSON.parse(session.batchProgressJson) as BatchProgress)
            : null,
        );
        return scripted.proposeRound(request);
      },
    };
    scripted.push(nothingMore);
    setInterviewer(watching);

    await applyReopenBatch.run({
      sessionId,
      items: [{ decisionKey: "sync", answer: "Push" }],
    });

    expect(seen).toEqual([
      {
        total: 1,
        completed: 0,
        current: { decisionId: sync.id, title: "How does it sync?" },
        outcomes: [],
      },
    ]);
    expect(await storedProgress(sessionId)).toBeNull();
  });

  it("defers the other cards of an open round rather than leaving it unsubmittable", async () => {
    // A round is open on `tone` when the batch arrives. The batch was not asked
    // about it and may not answer it, so it is deferred — which submits the
    // round and hands the question straight back, asked again rather than lost.
    const { sessionId } = await aSettledChain(
      proposal({ key: "tone", title: "What tone?" }),
      review(
        { key: "storage", verdict: "reconfirm" },
        { key: "sync", verdict: "reconfirm" },
      ),
      nothingMore,
    );

    await applyReopenBatch.run({
      sessionId,
      items: [{ decisionKey: "shape", answer: "A page, after all" }],
    });

    const tone = (await treeBy(sessionId)).tone;
    expect(tone?.previousAnswers).toEqual([
      expect.objectContaining({ kind: "deferred" }),
    ]);

    const open = await getCurrentRound.run({ sessionId });
    expect(open.round?.decisions.map((card) => card.key)).toEqual(["tone"]);
  });
});

/** The loose-end path leaves the tree ready for the interview to move on. */
describe("apply-reopen-batch and answer-decision agree", () => {
  useTestDatabase();
  afterEach(resetInterviewer);

  it("settles a loose end the same way answering it by hand does", async () => {
    const { sessionId } = await aSettledChain(nothingMore);
    const sync = (await treeBy(sessionId)).sync!;
    await getDb()
      .update(schema.decisions)
      .set({ answerKind: "deferred", currentAnswer: null, settledAt: null })
      .where(eq(schema.decisions.id, sync.id));

    await applyReopenBatch.run({
      sessionId,
      items: [{ decisionKey: "sync", answer: "Poll" }],
    });

    expect((await treeBy(sessionId)).sync).toMatchObject({
      state: "settled",
      answer: { text: "Poll", kind: "own-answer" },
    });
    // The hand path refuses it now, because it is no longer a loose end.
    await expect(
      answerDecision.run({ decisionId: sync.id, answer: "Poll" }),
    ).rejects.toThrow(/not an unresolved loose end/);
  });
});
