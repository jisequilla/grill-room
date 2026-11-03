import { eq } from "@agent-native/core/db/schema";
import { describe, expect, it } from "vitest";

import { getDb, schema, useTestDatabase } from "../test/db.js";
import createSession from "./create-session.js";
import dismissRestatement from "./dismiss-restatement.js";
import listLooseEnds from "./list-loose-ends.js";

const ORIGINAL = "Stirpe. Claude, double-check the fee table.";
const SETTLED_AT = "2026-09-01T00:00:01.000Z";

async function aSettledOwnAnswer(
  overrides: Partial<typeof schema.decisions.$inferInsert> = {},
) {
  const session = await createSession.run({
    title: "Grill Room",
    idea: "A marketplace for local services.",
  });
  const now = new Date().toISOString();
  await getDb()
    .insert(schema.decisions)
    .values({
      id: "d-provider",
      sessionId: session.id,
      key: "provider",
      questionTitle: "Which payment provider handles payouts?",
      questionBody: "",
      offeredChoicesJson: "[]",
      dependsOnJson: "[]",
      introducedBy: "interviewer",
      answerKind: "own-answer",
      currentAnswer: ORIGINAL,
      settledAt: SETTLED_AT,
      proposalKind: "restatement",
      restatementText: "Stripe.",
      restatementNotes: "Claude, double-check the fee table.",
      restatementReason: "Took out a note to the AI.",
      createdAt: now,
      updatedAt: now,
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

describe("dismiss-restatement", () => {
  useTestDatabase();

  it("throws for a decision id that does not exist", async () => {
    await expect(
      dismissRestatement.run({ decisionId: "missing" }),
    ).rejects.toThrow("Decision not found: missing");
  });

  it("refuses a decision with no restatement pending, with no-restatement", async () => {
    await aSettledOwnAnswer({
      proposalKind: null,
      restatementText: null,
      restatementNotes: null,
      restatementReason: null,
    });

    await expect(
      dismissRestatement.run({ decisionId: "d-provider" }),
    ).rejects.toMatchObject({ errorCode: "no-restatement", statusCode: 409 });
  });

  it("clears the restatement and remembers its dismissal", async () => {
    const session = await aSettledOwnAnswer();
    const before = await readDecision("d-provider");

    const view = await dismissRestatement.run({ decisionId: "d-provider" });

    const after = await readDecision("d-provider");
    const {
      updatedAt: _before,
      dismissedProposalsJson: _none,
      ...restBefore
    } = before!;
    const { updatedAt: _after, dismissedProposalsJson, ...restAfter } = after!;
    expect(restAfter).toEqual({
      ...restBefore,
      proposalKind: null,
      restatementText: null,
      restatementNotes: null,
      restatementReason: null,
    });
    expect(JSON.parse(dismissedProposalsJson!)).toEqual([
      {
        kind: "restatement",
        reason: "Took out a note to the AI.",
        dismissedAt: expect.any(String),
        text: "Stripe.",
      },
    ]);
    expect(view).toMatchObject({
      state: "settled",
      answer: { kind: "own-answer", text: ORIGINAL },
      restatementText: null,
    });
    expect(
      await getDb()
        .select()
        .from(schema.decisionHistory)
        .where(eq(schema.decisionHistory.decisionId, "d-provider")),
    ).toEqual([]);
    expect(await listLooseEnds.run({ sessionId: session.id })).toEqual([]);
  });

  it("K5: clears the proposal's kind", async () => {
    await aSettledOwnAnswer({ proposalKind: "restatement" });

    await dismissRestatement.run({ decisionId: "d-provider" });

    expect(await readDecision("d-provider")).toMatchObject({ restatementText: null, proposalKind: null });
  });
});

describe("dismiss-restatement: the Proposal module", () => {
  useTestDatabase();

  const PROPOSAL = {
    proposalKind: "restatement" as const,
    restatementText: "A clean",
    restatementNotes: "n",
    restatementReason: "r",
  };
  const LOCK_MESSAGE =
    "The interviewer is working on this session. Wait for the turn to finish before dismissing a restatement.";

  it("gr-wim.3 row 2: clears the restatement and remembers its dismissal, leaving the spec current", async () => {
    await anAnswerChangeFixture(PROPOSAL);

    await dismissRestatement.run({ decisionId: "d-x" });

    expect(await readDecision("d-x")).toMatchObject({
      proposalKind: null,
      restatementText: null,
      currentAnswer: "A",
    });
    expect(await dismissalsOf("d-x")).toEqual([
      {
        kind: "restatement",
        reason: "r",
        text: "A clean",
        dismissedAt: expect.any(String),
      },
    ]);
    expect(await getDb().select().from(schema.decisionHistory)).toEqual([]);
    expect((await readSpec()).current).toBe(true);
  });

  it("gr-wim.3 row 7: refuses a pending restatement while the interviewer is working, writing nothing", async () => {
    await anAnswerChangeFixture(PROPOSAL, { turnWorking: true });

    await expectTurnLockRefusal(
      () => dismissRestatement.run({ decisionId: "d-x" }),
      LOCK_MESSAGE,
    );
  });

  it("gr-wim.3 row 8: refuses no-restatement before checking the turn lock", async () => {
    await anAnswerChangeFixture({}, { turnWorking: true });

    await expect(
      dismissRestatement.run({ decisionId: "d-x" }),
    ).rejects.toMatchObject({ errorCode: "no-restatement", statusCode: 409 });
  });

  it.each([
    [
      "deferral",
      { proposalKind: "deferral" as const, deferralReason: "later" },
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
    "gr-wim.3 row 9: refuses a pending %s with no-restatement, changing nothing",
    async (_kind, seed) => {
      await anAnswerChangeFixture(seed);
      const before = await readDecision("d-x");

      await expect(
        dismissRestatement.run({ decisionId: "d-x" }),
      ).rejects.toMatchObject({ errorCode: "no-restatement", statusCode: 409 });
      expect(await readDecision("d-x")).toEqual(before);
    },
  );

  it("gr-wim.3 row 10: refuses a stale restatement text with no stored kind, with no-restatement", async () => {
    await anAnswerChangeFixture({ proposalKind: null, restatementText: "A clean" });

    await expect(
      dismissRestatement.run({ decisionId: "d-x" }),
    ).rejects.toMatchObject({ errorCode: "no-restatement", statusCode: 409 });
  });
});
