import { eq } from "@agent-native/core/db/schema";
import { afterEach, describe, expect, it } from "vitest";

import {
  buildPrompt,
  resetInterviewer,
  scriptInterviewer,
} from "../server/interviewer/index.js";
import { getDb, schema, useTestDatabase } from "../test/db.js";
import acceptDeferral from "./accept-deferral.js";
import acceptRestatement from "./accept-restatement.js";
import createSession from "./create-session.js";
import dismissRestatement from "./dismiss-restatement.js";
import findSuperseded from "./find-superseded.js";
import getTree from "./get-tree.js";
import listLooseEnds from "./list-loose-ends.js";
import reopenDecision from "./reopen-decision.js";

const ORIGINAL = "Stirpe. Claude, double-check the fee table.";
const STATEMENT = "Stripe.";
const NOTES = "Claude, double-check the fee table.";
const REASON = "Fixed the spelling of Stripe and took out a note to the AI.";
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

/** A session whose one settled own answer carries a pending restatement. */
async function aPendingRestatement(
  overrides: Omit<
    Partial<typeof schema.decisions.$inferInsert>,
    "id" | "key" | "questionTitle"
  > = {},
) {
  const session = await aSession();
  await insertDecision(session.id, {
    id: "d-provider",
    key: "provider",
    questionTitle: "Which payment provider handles payouts?",
    questionBody: "The provider sets the fees.",
    answerKind: "own-answer",
    currentAnswer: ORIGINAL,
    settledAt: SETTLED_AT,
    restatementText: STATEMENT,
    restatementNotes: NOTES,
    restatementReason: REASON,
    ...overrides,
  });
  return session;
}

const NOW_STAMP = "2026-09-01T00:00:00.000Z";

/**
 * The answer change fixture: decision X in a confirmed session with a current
 * spec, settled decisions V and W, Y with a pending supersession by X, Z
 * replaced by X, and (where a row says so) W having settled X.
 */
async function anAnswerChangeFixture(
  x: Partial<typeof schema.decisions.$inferInsert> = {},
  session: { turnWorking?: boolean } = {},
) {
  const created = await aSession();
  const sessionId = created.id;
  await getDb()
    .update(schema.sessions)
    .set({
      state: "confirmed",
      doneSummary: "Everything is settled.",
      ...(session.turnWorking
        ? { turnStatus: "working", turnStartedAt: new Date().toISOString() }
        : {}),
    })
    .where(eq(schema.sessions.id, sessionId));
  await getDb().insert(schema.specs).values({
    id: "spec-1",
    sessionId,
    markdown: "# Grill Room\n",
    current: true,
    createdAt: NOW_STAMP,
    updatedAt: NOW_STAMP,
  });
  for (const id of ["v", "w"]) {
    await insertDecision(sessionId, {
      id: `d-${id}`,
      key: id,
      questionTitle: `Decision ${id.toUpperCase()}`,
      answerKind: "own-answer",
      currentAnswer: `Answer ${id.toUpperCase()}`,
      settledAt: NOW_STAMP,
    });
  }
  await insertDecision(sessionId, {
    id: "d-x",
    key: "x",
    questionTitle: "Decision X",
    questionBody: "X body",
    answerKind: "own-answer",
    currentAnswer: "A",
    settledAt: NOW_STAMP,
    ...x,
  });
  await insertDecision(sessionId, {
    id: "d-y",
    key: "y",
    questionTitle: "Decision Y",
    answerKind: "unknown",
    currentAnswer: "",
    supersededById: "d-x",
    supersessionAnswer: "From X",
    supersessionReason: "X answers it",
  });
  await insertDecision(sessionId, {
    id: "d-z",
    key: "z",
    questionTitle: "Decision Z",
    answerKind: "own-answer",
    currentAnswer: "Old",
    settledAt: NOW_STAMP,
    replacedById: "d-x",
    replacedReason: "X replaced it",
  });
  return sessionId;
}

async function readSpec() {
  const [spec] = await getDb().select().from(schema.specs);
  return spec!;
}

/** Expects the turn lock to refuse the call, writing nothing. */
async function expectTurnLockRefusal(
  run: () => Promise<unknown>,
  message: string,
) {
  const decisionsBefore = await getDb().select().from(schema.decisions);
  const specBefore = await readSpec();

  const refusal = run();

  await expect(refusal).rejects.toMatchObject({
    errorCode: "turn-in-progress",
    statusCode: 409,
  });
  await expect(refusal).rejects.toThrow(message);
  expect(await getDb().select().from(schema.decisionHistory)).toEqual([]);
  expect(await getDb().select().from(schema.decisions)).toEqual(decisionsBefore);
  expect(await readSpec()).toEqual(specBefore);
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

function readSession(id: string) {
  return getDb()
    .select()
    .from(schema.sessions)
    .where(eq(schema.sessions.id, id))
    .limit(1)
    .then((rows) => rows[0]);
}

const CLEARED = {
  restatementText: null,
  restatementNotes: null,
  restatementReason: null,
};

describe("accept-restatement", () => {
  useTestDatabase();
  afterEach(resetInterviewer);

  it("throws for a decision id that does not exist", async () => {
    await expect(
      acceptRestatement.run({ decisionId: "missing" }),
    ).rejects.toThrow("Decision not found: missing");
  });

  it("refuses a decision with no restatement pending, with no-restatement, changing nothing", async () => {
    await aPendingRestatement(CLEARED);

    await expect(
      acceptRestatement.run({ decisionId: "d-provider" }),
    ).rejects.toMatchObject({ errorCode: "no-restatement", statusCode: 409 });
    expect(await readDecision("d-provider")).toMatchObject({
      currentAnswer: ORIGINAL,
    });
    expect(await historyOf("d-provider")).toEqual([]);
  });

  it("refuses a blank statement, with empty-statement, changing nothing", async () => {
    await aPendingRestatement();

    await expect(
      acceptRestatement.run({ decisionId: "d-provider", statement: "   " }),
    ).rejects.toMatchObject({ errorCode: "empty-statement", statusCode: 400 });
    expect(await readDecision("d-provider")).toMatchObject({
      currentAnswer: ORIGINAL,
      restatementText: STATEMENT,
    });
    expect(await historyOf("d-provider")).toEqual([]);
  });

  it("replaces the answer with the statement, keeping kind, settledAt and settledById, and clears the proposal", async () => {
    const session = await aPendingRestatement({ settledById: "d-provider-origin" });

    const view = await acceptRestatement.run({ decisionId: "d-provider" });

    expect(await readDecision("d-provider")).toMatchObject({
      currentAnswer: STATEMENT,
      answerKind: "own-answer",
      settledAt: SETTLED_AT,
      settledById: "d-provider-origin",
      reopenedAt: null,
      ...CLEARED,
    });
    expect(view).toMatchObject({
      state: "settled",
      answer: { kind: "own-answer", text: STATEMENT },
      ...CLEARED,
    });
    expect(await listLooseEnds.run({ sessionId: session.id })).toEqual([]);
  });

  it("records the owner's edited statement, trimmed, instead of the proposed one", async () => {
    await aPendingRestatement();

    await acceptRestatement.run({
      decisionId: "d-provider",
      statement: "  Stripe, on the standard plan.  ",
    });

    expect(await readDecision("d-provider")).toMatchObject({
      currentAnswer: "Stripe, on the standard plan.",
      ...CLEARED,
    });
    expect(await historyOf("d-provider")).toMatchObject([
      { answer: ORIGINAL, operatorNotes: NOTES },
    ]);
  });

  it("adds no staleness: every other decision keeps its state", async () => {
    const session = await aPendingRestatement();
    await insertDecision(session.id, {
      id: "d-fees",
      key: "fees",
      questionTitle: "Who pays the processing fee?",
      dependsOnJson: JSON.stringify(["d-provider"]),
      answerKind: "own-answer",
      currentAnswer: "The seller.",
      settledAt: "2026-09-01T00:00:02.000Z",
    });
    await insertDecision(session.id, {
      id: "d-refunds",
      key: "refunds",
      questionTitle: "How are refunds paid?",
      dependsOnJson: JSON.stringify(["d-provider"]),
    });
    const before = await getTree.run({ sessionId: session.id });

    await acceptRestatement.run({ decisionId: "d-provider" });

    const after = await getTree.run({ sessionId: session.id });
    const states = (tree: typeof before) =>
      Object.fromEntries(tree.decisions.map((d) => [d.key, d.state]));
    expect(states(after)).toEqual(states(before));
    expect(states(after)).toEqual({
      provider: "settled",
      fees: "settled",
      refunds: "frontier",
    });
  });
});

describe("accept-restatement: the answer change rule", () => {
  useTestDatabase();

  const PROPOSAL = {
    restatementText: "A clean",
    restatementNotes: "n",
    restatementReason: "r",
  };

  it("row 3: rewords with the whole answer change rule", async () => {
    await anAnswerChangeFixture({
      ...PROPOSAL,
      settledById: "d-w",
      deferralReason: "later",
    });

    await acceptRestatement.run({ decisionId: "d-x" });

    expect(await readDecision("d-x")).toMatchObject({
      currentAnswer: "A clean",
      answerKind: "own-answer",
      settledAt: NOW_STAMP,
      settledById: "d-w",
      deferralReason: null,
      restatementText: null,
      restatementNotes: null,
      restatementReason: null,
    });
    expect(await readDecision("d-z")).toMatchObject({ replacedById: "d-x" });
    expect(await readDecision("d-y")).toMatchObject({
      supersededById: null,
      supersessionAnswer: null,
      supersessionReason: null,
    });
    expect((await readSpec()).current).toBe(false);
    expect(await historyOf("d-x")).toMatchObject([
      {
        answer: "A",
        answerKind: "own-answer",
        operatorNotes: "n",
        interviewerReason: "r",
        questionTitle: "Decision X",
        questionBody: "X body",
      },
    ]);
  });

  it("row 4: history records the kind the answer had", async () => {
    await anAnswerChangeFixture({
      ...PROPOSAL,
      answerKind: "accepted-recommendation",
    });

    await acceptRestatement.run({ decisionId: "d-x" });

    expect(await historyOf("d-x")).toMatchObject([
      { answerKind: "accepted-recommendation" },
    ]);
  });

  it("row 8: refuses while the interviewer is working, writing nothing", async () => {
    await anAnswerChangeFixture(PROPOSAL, { turnWorking: true });

    await expectTurnLockRefusal(
      () => acceptRestatement.run({ decisionId: "d-x" }),
      "The interviewer is working on this session. Wait for the turn to finish before accepting a restatement.",
    );
  });

  it("row 9: refuses no-restatement before checking the turn lock", async () => {
    await anAnswerChangeFixture({}, { turnWorking: true });

    await expect(
      acceptRestatement.run({ decisionId: "d-x" }),
    ).rejects.toMatchObject({ errorCode: "no-restatement", statusCode: 409 });
  });

  it("row 9: refuses an empty statement before checking the turn lock", async () => {
    await anAnswerChangeFixture(PROPOSAL, { turnWorking: true });

    await expect(
      acceptRestatement.run({ decisionId: "d-x", statement: "   " }),
    ).rejects.toMatchObject({ errorCode: "empty-statement", statusCode: 400 });
  });

  it("row 10: blank proposal notes are recorded as empty operator notes, not null", async () => {
    await anAnswerChangeFixture({ ...PROPOSAL, restatementNotes: "  " });

    await acceptRestatement.run({ decisionId: "d-x" });

    expect(await historyOf("d-x")).toMatchObject([{ operatorNotes: "" }]);
  });

  it("row 11: the owner's edited statement is trimmed and becomes the answer", async () => {
    await anAnswerChangeFixture(PROPOSAL);

    await acceptRestatement.run({ decisionId: "d-x", statement: " B " });

    expect(await readDecision("d-x")).toMatchObject({ currentAnswer: "B" });
  });
});

describe("accept-restatement: the other rows that point at it", () => {
  useTestDatabase();

  /**
   * provider: a settled own answer with a restatement pending. window: a loose
   * end whose pending supersession quotes provider's old text. old: a decision
   * provider replaced. settled: a former loose end provider's answer settled.
   */
  async function aRestatementOthersPointAt() {
    const session = await aPendingRestatement();
    await insertDecision(session.id, {
      id: "d-window",
      key: "window",
      questionTitle: "Who is the fallback provider?",
      answerKind: "unknown",
      currentAnswer: "",
      supersededById: "d-provider",
      supersessionAnswer: "Stirpe, per the provider decision.",
      supersessionReason: "The provider decision answers it.",
    });
    await insertDecision(session.id, {
      id: "d-old",
      key: "old",
      questionTitle: "Which processor did we start with?",
      answerKind: "own-answer",
      currentAnswer: "PayPal.",
      settledAt: "2026-09-01T00:00:00.000Z",
      replacedById: "d-provider",
      replacedReason: "Provider moved to Stripe.",
    });
    await insertDecision(session.id, {
      id: "d-settled",
      key: "settled",
      questionTitle: "Which provider handles refunds?",
      answerKind: "own-answer",
      currentAnswer: "Stripe.",
      settledAt: "2026-09-01T00:00:03.000Z",
      settledById: "d-provider",
    });
    return session;
  }

  it("leaves what it replaced and what it settled pointing at it", async () => {
    await aRestatementOthersPointAt();

    await acceptRestatement.run({ decisionId: "d-provider" });

    expect(await readDecision("d-old")).toMatchObject({
      replacedById: "d-provider",
      replacedReason: "Provider moved to Stripe.",
      currentAnswer: "PayPal.",
    });
    expect(await readDecision("d-settled")).toMatchObject({
      settledById: "d-provider",
      currentAnswer: "Stripe.",
    });
  });

  it("reopening still withdraws both kinds of claim, as before the split", async () => {
    await aRestatementOthersPointAt();

    await reopenDecision.run({ decisionId: "d-provider" });

    expect(await readDecision("d-window")).toMatchObject({ supersededById: null });
    expect(await readDecision("d-old")).toMatchObject({
      replacedById: null,
      replacedReason: null,
    });
    expect(await readDecision("d-settled")).toMatchObject({
      settledById: "d-provider",
    });
  });
});

describe("accept-restatement: the spec", () => {
  useTestDatabase();

  async function confirmedWithSpec() {
    const session = await aPendingRestatement();
    const now = "2026-09-02T00:00:00.000Z";
    await getDb()
      .update(schema.sessions)
      .set({ state: "confirmed" })
      .where(eq(schema.sessions.id, session.id));
    await getDb().insert(schema.specs).values({
      id: "spec-1",
      sessionId: session.id,
      markdown: "## Problem\n\nStirpe.",
      current: true,
      createdAt: now,
      updatedAt: now,
    });
    return session;
  }

  it("marks the session's spec not current, and leaves the session's state alone", async () => {
    const session = await confirmedWithSpec();

    await acceptRestatement.run({ decisionId: "d-provider" });

    const [spec] = await getDb()
      .select()
      .from(schema.specs)
      .where(eq(schema.specs.sessionId, session.id));
    expect(spec).toMatchObject({ current: false });
    expect(await readSession(session.id)).toMatchObject({ state: "confirmed" });
  });

  it("accepts on a confirmed session with no spec, leaving the session confirmed", async () => {
    const session = await aPendingRestatement();
    await getDb()
      .update(schema.sessions)
      .set({ state: "confirmed", doneSummary: "Everything is settled." })
      .where(eq(schema.sessions.id, session.id));

    await acceptRestatement.run({ decisionId: "d-provider" });

    expect(await readSession(session.id)).toMatchObject({
      state: "confirmed",
      doneSummary: "Everything is settled.",
    });
    expect(await getDb().select().from(schema.specs)).toEqual([]);
  });

  it("dismissing leaves the spec current", async () => {
    const session = await confirmedWithSpec();

    await dismissRestatement.run({ decisionId: "d-provider" });

    const [spec] = await getDb()
      .select()
      .from(schema.specs)
      .where(eq(schema.specs.sessionId, session.id));
    expect(spec).toMatchObject({ current: true });
  });
});

describe("accept-restatement: what reaches the interviewer", () => {
  useTestDatabase();
  afterEach(resetInterviewer);

  it("renders the statement, and neither the notes nor the original text, in the next request, history included", async () => {
    const session = await aPendingRestatement();
    await acceptRestatement.run({ decisionId: "d-provider" });
    const interviewer = scriptInterviewer([
      {
        kind: "find-superseded",
        result: {
          supersessions: [],
          replacements: [],
          deferrals: [],
          restatements: [],
        },
      },
    ]);

    await findSuperseded.run({ sessionId: session.id });

    const [request] = interviewer.requests;
    const provider = request!.context.decisions.find(
      (decision) => decision.key === "provider",
    );
    expect(provider).toMatchObject({
      answer: { kind: "own-answer", text: STATEMENT },
    });
    const prompt = buildPrompt(request!);
    expect(prompt).toContain(`answer (own-answer): ${STATEMENT}`);
    expect(prompt).not.toContain(NOTES);
    expect(prompt).not.toContain("Stirpe");
    // The history entry is still there for the owner.
    const tree = await getTree.run({ sessionId: session.id });
    expect(
      tree.decisions.find((d) => d.key === "provider")?.previousAnswers,
    ).toMatchObject([{ text: ORIGINAL, operatorNotes: NOTES }]);
  });

  /** Accepts, then returns the prompt text of the next find-superseded request. */
  async function nextPromptAfterAccepting(
    sessionId: string,
    statement?: string,
  ) {
    await acceptRestatement.run({ decisionId: "d-provider", statement });
    const interviewer = scriptInterviewer([
      {
        kind: "find-superseded",
        result: {
          supersessions: [],
          replacements: [],
          deferrals: [],
          restatements: [],
        },
      },
    ]);
    await findSuperseded.run({ sessionId });
    return buildPrompt(interviewer.requests[0]!);
  }

  it("keeps the original text out of a later prompt when a typo-only proposal was edited to remove notes", async () => {
    // The model proposed only a typo fix, with empty notes; the owner's edit
    // is what takes the note to the AI out.
    const session = await aPendingRestatement({
      restatementText: "Stripe. Claude, double-check the fee table.",
      restatementNotes: "",
      restatementReason: "Fixed the spelling of Stripe.",
    });

    const prompt = await nextPromptAfterAccepting(session.id, "Stripe.");

    expect(prompt).toContain("answer (own-answer): Stripe.");
    expect(prompt).not.toContain("Stirpe");
    expect(prompt).not.toContain("double-check the fee table");
  });

  it("keeps a typo-only restatement's original text out of a later prompt", async () => {
    const session = await aPendingRestatement({
      currentAnswer: "Postgress with a read replca",
      restatementText: "Postgres with a read replica",
      restatementNotes: "",
      restatementReason: "Fixed two typos.",
    });

    const prompt = await nextPromptAfterAccepting(session.id);

    expect(prompt).toContain("answer (own-answer): Postgres with a read replica");
    expect(prompt).not.toContain("Postgress");
    expect(prompt).not.toContain("replca");
  });
});

describe("accept-deferral beside a restatement", () => {
  useTestDatabase();

  it("clears the restatement columns too, through the shared proposal constant", async () => {
    // Never both pending in practice: the check skips one for the other.
    await aPendingRestatement({ deferralReason: "It waits on the fee review." });

    await acceptDeferral.run({ decisionId: "d-provider" });

    expect(await readDecision("d-provider")).toMatchObject({
      answerKind: "deferred",
      deferralReason: null,
      ...CLEARED,
    });
  });
});
