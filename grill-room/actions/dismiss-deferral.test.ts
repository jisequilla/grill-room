import { eq } from "@agent-native/core/db/schema";
import { describe, expect, it } from "vitest";

import { getDb, schema, useTestDatabase } from "../test/db.js";
import createSession from "./create-session.js";
import dismissDeferral from "./dismiss-deferral.js";
import listLooseEnds from "./list-loose-ends.js";

const SETTLED_AT = "2026-09-01T00:00:01.000Z";

async function aSettledOwnAnswer(deferralReason: string | null) {
  const session = await createSession.run({
    title: "Grill Room",
    idea: "A marketplace for local services.",
  });
  const now = new Date().toISOString();
  await getDb()
    .insert(schema.decisions)
    .values({
      id: "d-hold",
      sessionId: session.id,
      key: "hold",
      questionTitle: "How long is a payout held?",
      questionBody: "",
      offeredChoicesJson: "[]",
      dependsOnJson: "[]",
      introducedBy: "interviewer",
      answerKind: "own-answer",
      currentAnswer: "48 hours; revisit after launch",
      settledAt: SETTLED_AT,
      proposalKind: deferralReason == null ? null : "deferral",
      deferralReason,
      createdAt: now,
      updatedAt: now,
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

const NOW_STAMP = "2026-09-01T00:00:00.000Z";

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

/**
 * The answer change fixture: decision X in a confirmed session with a current
 * spec, settled decisions V and W, Y with a pending supersession by X, Z
 * replaced by X, and (where a row says so) W having settled X.
 */
async function anAnswerChangeFixture(
  x: Omit<
    Partial<typeof schema.decisions.$inferInsert>,
    "id" | "key" | "questionTitle"
  > = {},
  session: { turnWorking?: boolean } = {},
) {
  const created = await createSession.run({
    title: "Grill Room",
    idea: "A marketplace for local services.",
  });
  const sessionId = created.id!;
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
  run: () => unknown,
  message: string,
) {
  const decisionsBefore = await getDb().select().from(schema.decisions);
  const specBefore = await readSpec();

  const refusal = Promise.resolve(run());

  await expect(refusal).rejects.toMatchObject({
    errorCode: "turn-in-progress",
    statusCode: 409,
  });
  await expect(refusal).rejects.toThrow(message);
  expect(await getDb().select().from(schema.decisionHistory)).toEqual([]);
  expect(await getDb().select().from(schema.decisions)).toEqual(decisionsBefore);
  expect(await readSpec()).toEqual(specBefore);
}

async function dismissalsOf(id: string) {
  const row = await readDecision(id);
  return JSON.parse(row!.dismissedProposalsJson ?? "null");
}

describe("dismiss-deferral", () => {
  useTestDatabase();

  it("throws for a decision id that does not exist", async () => {
    await expect(dismissDeferral.run({ decisionId: "missing" })).rejects.toThrow(
      "Decision not found: missing",
    );
  });

  it("refuses a decision with no deferral pending, with no-deferral", async () => {
    await aSettledOwnAnswer(null);

    await expect(
      dismissDeferral.run({ decisionId: "d-hold" }),
    ).rejects.toMatchObject({ errorCode: "no-deferral", statusCode: 409 });
  });

  it("clears the proposal and leaves the decision settled, recording nothing in history", async () => {
    const session = await aSettledOwnAnswer("It reads as waiting on launch.");

    const view = await dismissDeferral.run({ decisionId: "d-hold" });

    expect(view).toMatchObject({
      state: "settled",
      answer: { kind: "own-answer", text: "48 hours; revisit after launch" },
      deferralReason: null,
    });
    expect(await readDecision("d-hold")).toMatchObject({
      answerKind: "own-answer",
      currentAnswer: "48 hours; revisit after launch",
      settledAt: SETTLED_AT,
      deferralReason: null,
    });
    expect(
      await getDb()
        .select()
        .from(schema.decisionHistory)
        .where(eq(schema.decisionHistory.decisionId, "d-hold")),
    ).toEqual([]);
    expect(await listLooseEnds.run({ sessionId: session.id })).toEqual([]);
  });

  it("K2: clears the proposal's kind", async () => {
    await aSettledOwnAnswer("It reads as waiting on launch.");
    await getDb()
      .update(schema.decisions)
      .set({ proposalKind: "deferral" })
      .where(eq(schema.decisions.id, "d-hold"));

    await dismissDeferral.run({ decisionId: "d-hold" });

    expect(await readDecision("d-hold")).toMatchObject({ deferralReason: null, proposalKind: null });
  });
});

describe("dismiss-deferral: the Proposal module", () => {
  useTestDatabase();

  const LOCK_MESSAGE =
    "The interviewer is working on this session. Wait for the turn to finish before dismissing a deferral.";

  it("gr-wim.3 row 1: clears the deferral and remembers its dismissal, recording nothing and leaving the spec current", async () => {
    await anAnswerChangeFixture({ proposalKind: "deferral", deferralReason: "later" });

    await dismissDeferral.run({ decisionId: "d-x" });

    expect(await readDecision("d-x")).toMatchObject({
      proposalKind: null,
      deferralReason: null,
      answerKind: "own-answer",
      currentAnswer: "A",
      settledAt: NOW_STAMP,
    });
    expect(await dismissalsOf("d-x")).toEqual([
      { kind: "deferral", reason: "later", dismissedAt: expect.any(String) },
    ]);
    expect(await getDb().select().from(schema.decisionHistory)).toEqual([]);
    expect((await readSpec()).current).toBe(true);
  });

  it("gr-wim.3 row 7: refuses a pending deferral while the interviewer is working, writing nothing", async () => {
    await anAnswerChangeFixture(
      { proposalKind: "deferral", deferralReason: "later" },
      { turnWorking: true },
    );

    await expectTurnLockRefusal(
      () => dismissDeferral.run({ decisionId: "d-x" }),
      LOCK_MESSAGE,
    );
  });

  it("gr-wim.3 row 8: refuses no-deferral before checking the turn lock", async () => {
    await anAnswerChangeFixture({}, { turnWorking: true });

    await expect(
      dismissDeferral.run({ decisionId: "d-x" }),
    ).rejects.toMatchObject({ errorCode: "no-deferral", statusCode: 409 });
  });

  it.each([
    [
      "restatement",
      {
        proposalKind: "restatement" as const,
        restatementText: "A clean",
        restatementNotes: "n",
        restatementReason: "r",
      },
    ],
    [
      "replacement",
      {
        proposalKind: "replacement" as const,
        supersededById: "d-v",
        supersessionReason: "r",
      },
    ],
    [
      "answered-by",
      {
        answerKind: "unknown" as const,
        currentAnswer: "dunno",
        settledAt: null,
        proposalKind: "answered-by" as const,
        supersededById: "d-v",
        supersessionAnswer: "B",
        supersessionReason: "r",
      },
    ],
  ])(
    "gr-wim.3 row 9: refuses a pending %s with no-deferral, changing nothing",
    async (_kind, seed) => {
      await anAnswerChangeFixture(seed);
      const before = await readDecision("d-x");

      await expect(
        dismissDeferral.run({ decisionId: "d-x" }),
      ).rejects.toMatchObject({ errorCode: "no-deferral", statusCode: 409 });
      expect(await readDecision("d-x")).toEqual(before);
    },
  );

  it("gr-wim.3 row 10: refuses a stale deferral reason with no stored kind, with no-deferral", async () => {
    await anAnswerChangeFixture({ proposalKind: null, deferralReason: "later" });

    await expect(
      dismissDeferral.run({ decisionId: "d-x" }),
    ).rejects.toMatchObject({ errorCode: "no-deferral", statusCode: 409 });
  });

  it("gr-wim.3 row 12: dismisses a pending deferral whose reason is null", async () => {
    await anAnswerChangeFixture({ proposalKind: "deferral", deferralReason: null });

    await dismissDeferral.run({ decisionId: "d-x" });

    expect(await readDecision("d-x")).toMatchObject({ proposalKind: null });
    expect(await dismissalsOf("d-x")).toEqual([
      { kind: "deferral", reason: null, dismissedAt: expect.any(String) },
    ]);
  });
});
