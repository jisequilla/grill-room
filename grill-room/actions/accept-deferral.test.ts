import { eq } from "@agent-native/core/db/schema";
import { afterEach, describe, expect, it } from "vitest";

import {
  resetInterviewer,
  scriptInterviewer,
  type ScriptedTurn,
} from "../server/interviewer/index.js";
import { CLEARED_PROPOSAL, CLEARED_SUPERSESSION } from "../server/tree.js";
import { getDb, schema, useTestDatabase } from "../test/db.js";
import { MAX_TURN_RETRIES } from "../server/turn.js";
import acceptDeferral from "./accept-deferral.js";
import acceptSupersession from "./accept-supersession.js";
import confirmSession from "./confirm-session.js";
import createSession from "./create-session.js";
import findSuperseded from "./find-superseded.js";
import getTree from "./get-tree.js";
import listLooseEnds from "./list-loose-ends.js";
import reopenDecision from "./reopen-decision.js";
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

  it("clears every link and supersession column the settled answer carried", async () => {
    const session = await aPendingDeferral();
    await insertDecision(session.id, {
      id: "d-disputes",
      key: "disputes",
      questionTitle: "How are disputes handled?",
      answerKind: "own-answer",
      currentAnswer: "By the platform, within 48 hours.",
      settledAt: "2026-09-01T00:00:02.000Z",
    });
    await getDb()
      .update(schema.decisions)
      .set({
        supersededById: "d-disputes",
        supersessionAnswer: "Held for 48 hours.",
        supersessionReason: "Disputes decide it.",
        replacedById: "d-disputes",
        replacedReason: "Disputes changed it.",
        settledById: "d-disputes",
      })
      .where(eq(schema.decisions.id, "d-hold"));

    const view = await acceptDeferral.run({ decisionId: "d-hold" });

    expect(await readDecision("d-hold")).toMatchObject({
      answerKind: "deferred",
      supersededById: null,
      supersessionAnswer: null,
      supersessionReason: null,
      replacedById: null,
      replacedReason: null,
      settledById: null,
    });
    expect(view).toMatchObject({
      supersession: null,
      replacedBy: null,
      settledBy: null,
    });
  });

  it("regression: a replacement proposed after a deferral can never settle the decision as an empty answer", async () => {
    // The reviewer's scenario: hold carries a pending deferral, disputes
    // settled later, and the check proposes disputes as replacing hold.
    const session = await aPendingDeferral();
    await insertDecision(session.id, {
      id: "d-disputes",
      key: "disputes",
      questionTitle: "How are disputes handled?",
      answerKind: "own-answer",
      currentAnswer: "By the platform, within 48 hours.",
      settledAt: "2026-09-01T00:00:02.000Z",
    });
    const replacement: ScriptedTurn = {
      kind: "find-superseded",
      result: {
        supersessions: [],
        replacements: [
          { replacedKey: "hold", byKey: "disputes", reason: "Disputes decide it." },
        ],
        deferrals: [],
      },
    };
    scriptInterviewer(
      Array.from({ length: MAX_TURN_RETRIES + 1 }, () => replacement),
    );

    await findSuperseded.run({ sessionId: session.id });

    expect(await readDecision("d-hold")).toMatchObject({
      supersededById: null,
      deferralReason: REASON,
    });

    await acceptDeferral.run({ decisionId: "d-hold" });

    const [looseEnd] = await listLooseEnds.run({ sessionId: session.id });
    expect(looseEnd).toMatchObject({ key: "hold", reason: "deferred", supersession: null });
    await expect(
      acceptSupersession.run({ decisionId: "d-hold" }),
    ).rejects.toThrow(/has no supersession to accept/);
    expect(await readDecision("d-hold")).toMatchObject({
      answerKind: "deferred",
      currentAnswer: ANSWER,
      settledAt: null,
      settledById: null,
    });
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

describe("accept-deferral: the claims other decisions make about its answer", () => {
  useTestDatabase();

  const WAIT = "Wait until launch";

  /**
   * disputes: a settled own answer with a deferral pending. window: a loose
   * end with a pending supersession naming disputes as its answer. old: a
   * settled decision disputes replaced.
   */
  async function aDeferralOthersClaimOn() {
    const session = await aSession();
    await insertDecision(session.id, {
      id: "d-disputes",
      key: "disputes",
      questionTitle: "How are disputes handled?",
      answerKind: "own-answer",
      currentAnswer: WAIT,
      settledAt: "2026-09-01T00:00:02.000Z",
      deferralReason: "It waits on launch.",
    });
    await insertDecision(session.id, {
      id: "d-window",
      key: "window",
      questionTitle: "How long is the dispute window?",
      answerKind: "unknown",
      currentAnswer: "",
      supersededById: "d-disputes",
      supersessionAnswer: WAIT,
      supersessionReason: "Disputes already answers it.",
    });
    await insertDecision(session.id, {
      id: "d-old",
      key: "old",
      questionTitle: "Who settles a dispute?",
      answerKind: "own-answer",
      currentAnswer: "Support, by hand.",
      settledAt: "2026-09-01T00:00:01.000Z",
      replacedById: "d-disputes",
      replacedReason: "Disputes changed it.",
    });
    return session;
  }

  const WITHDRAWN = {
    answerKind: "unknown",
    settledAt: null,
    settledById: null,
    supersededById: null,
    supersessionAnswer: null,
    supersessionReason: null,
  };
  const CURRENT_AGAIN = {
    answerKind: "own-answer",
    currentAnswer: "Support, by hand.",
    settledAt: "2026-09-01T00:00:01.000Z",
    replacedById: null,
    replacedReason: null,
  };

  it("withdraws a pending supersession on another decision that names it", async () => {
    const session = await aDeferralOthersClaimOn();

    await acceptDeferral.run({ decisionId: "d-disputes" });

    expect(await readDecision("d-window")).toMatchObject(WITHDRAWN);
    const looseEnds = await listLooseEnds.run({ sessionId: session.id });
    expect(looseEnds.find((end) => end.key === "window")).toMatchObject({
      reason: "unknown",
      supersession: null,
    });
  });

  it("clears Replaced by on another decision that points at it", async () => {
    await aDeferralOthersClaimOn();

    await acceptDeferral.run({ decisionId: "d-disputes" });

    expect(await readDecision("d-old")).toMatchObject(CURRENT_AGAIN);
  });

  it("regression: the withdrawn supersession can no longer settle the loose end with the deferred answer", async () => {
    const session = await aDeferralOthersClaimOn();

    await acceptDeferral.run({ decisionId: "d-disputes" });

    await expect(
      acceptSupersession.run({ decisionId: "d-window" }),
    ).rejects.toThrow(/has no supersession to accept/);
    expect(await readDecision("d-window")).toMatchObject(WITHDRAWN);
    expect(await listLooseEnds.run({ sessionId: session.id })).toMatchObject(
      expect.arrayContaining([
        expect.objectContaining({ key: "window", reason: "unknown" }),
        expect.objectContaining({ key: "disputes", reason: "deferred" }),
      ]),
    );
  });

  it("leaves window and old exactly as reopening the same decision does", async () => {
    await aDeferralOthersClaimOn();
    await acceptDeferral.run({ decisionId: "d-disputes" });
    const afterAccept = {
      window: await readDecision("d-window"),
      old: await readDecision("d-old"),
    };

    await getDb().delete(schema.decisions);
    await aDeferralOthersClaimOn();
    await reopenDecision.run({ decisionId: "d-disputes" });
    const afterReopen = {
      window: await readDecision("d-window"),
      old: await readDecision("d-old"),
    };

    const { updatedAt: _w1, sessionId: _s1, ...windowAccept } = afterAccept.window!;
    const { updatedAt: _w2, sessionId: _s2, ...windowReopen } = afterReopen.window!;
    const { updatedAt: _o1, sessionId: _s3, ...oldAccept } = afterAccept.old!;
    const { updatedAt: _o2, sessionId: _s4, ...oldReopen } = afterReopen.old!;
    expect(windowAccept).toEqual({ ...windowReopen, createdAt: windowAccept.createdAt });
    expect(oldAccept).toEqual({ ...oldReopen, createdAt: oldAccept.createdAt });
    expect(windowAccept).toMatchObject(WITHDRAWN);
    expect(oldAccept).toMatchObject(CURRENT_AGAIN);
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
