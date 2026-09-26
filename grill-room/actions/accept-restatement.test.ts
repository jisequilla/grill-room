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

  it("records the original text in history, with the interviewer's reason and the operator notes", async () => {
    await aPendingRestatement();

    await acceptRestatement.run({ decisionId: "d-provider" });

    expect(await historyOf("d-provider")).toMatchObject([
      {
        answer: ORIGINAL,
        answerKind: "own-answer",
        interviewerReason: REASON,
        operatorNotes: NOTES,
        questionTitle: "Which payment provider handles payouts?",
        questionBody: "The provider sets the fees.",
      },
    ]);
  });

  it("records no operator notes when the restatement only fixed typos", async () => {
    await aPendingRestatement({
      currentAnswer: "Postgress with a read replca",
      restatementText: "Postgres with a read replica",
      restatementNotes: "",
      restatementReason: "Fixed two typos.",
    });

    await acceptRestatement.run({ decisionId: "d-provider" });

    expect(await historyOf("d-provider")).toMatchObject([
      { answer: "Postgress with a read replca", operatorNotes: null },
    ]);
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

  it("withdraws another row's pending supersession that names it", async () => {
    const session = await aRestatementOthersPointAt();

    await acceptRestatement.run({ decisionId: "d-provider" });

    expect(await readDecision("d-window")).toMatchObject({
      answerKind: "unknown",
      supersededById: null,
      supersessionAnswer: null,
      supersessionReason: null,
    });
    expect(
      (await listLooseEnds.run({ sessionId: session.id })).find(
        (end) => end.key === "window",
      ),
    ).toMatchObject({ reason: "unknown", supersession: null });
  });

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

  it("accepts with no spec, changing no session", async () => {
    const session = await aPendingRestatement();
    const before = await readSession(session.id);

    await acceptRestatement.run({ decisionId: "d-provider" });

    expect(await readSession(session.id)).toMatchObject({
      state: before!.state,
      doneSummary: before!.doneSummary,
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
