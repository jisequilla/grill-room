import { eq } from "@agent-native/core/db/schema";
import { describe, expect, it } from "vitest";

import { getDb, schema, useTestDatabase } from "../test/db.js";
import createSession from "./create-session.js";
import dismissSupersession from "./dismiss-supersession.js";

/**
 * Two settled decisions, the first carrying a pending replacement by the
 * second, which settled later.
 */
async function aPendingReplacement() {
  const session = await createSession.run({
    title: "Grill Room",
    idea: "A local app that grills me about an idea until it is decided.",
  });
  const now = new Date().toISOString();
  const decision = {
    sessionId: session.id,
    questionBody: "",
    offeredChoicesJson: "[]",
    dependsOnJson: "[]",
    introducedBy: "interviewer" as const,
    createdAt: now,
    updatedAt: now,
  };
  // The replacing decision goes in first: the proposal column references it.
  await getDb().insert(schema.decisions).values({
    ...decision,
    id: "d-location",
    key: "storage-location",
    questionTitle: "Which disk does the data live on?",
    answerKind: "own-answer",
    currentAnswer: "A synced cloud folder",
    settledAt: "2026-09-01T00:00:02.000Z",
  });
  await getDb().insert(schema.decisions).values({
    ...decision,
    id: "d-storage",
    key: "storage",
    questionTitle: "Where does the data live?",
    answerKind: "own-answer",
    currentAnswer: "On disk",
    settledAt: "2026-09-01T00:00:01.000Z",
    supersededById: "d-location",
    supersessionReason: "Storage moved into a synced cloud folder.",
    proposalKind: "replacement",
  });
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

/** Re-points the fixture's loose end Y at V as a pending answered-by. */
async function pointLooseEndAtV() {
  await getDb()
    .update(schema.decisions)
    .set({
      proposalKind: "answered-by",
      supersededById: "d-v",
      supersessionAnswer: "B",
      supersessionReason: "r",
    })
    .where(eq(schema.decisions.id, "d-y"));
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

const REPLACEMENT = {
  proposalKind: "replacement" as const,
  supersededById: "d-v",
  supersessionReason: "r",
};
const LOCK_MESSAGE =
  "The interviewer is working on this session. Wait for the turn to finish before dismissing a supersession.";

describe("dismiss-supersession", () => {
  useTestDatabase();

  it("K3: dismissing a replacement clears the proposal and its kind", async () => {
    await aPendingReplacement();

    await dismissSupersession.run({ decisionId: "d-storage" });

    expect(await readDecision("d-storage")).toMatchObject({
      supersededById: null,
      supersessionAnswer: null,
      supersessionReason: null,
      proposalKind: null,
      currentAnswer: "On disk",
      replacedById: null,
    });
  });

  it("gr-wim.3: throws for a decision id that does not exist", async () => {
    await expect(
      dismissSupersession.run({ decisionId: "missing" }),
    ).rejects.toMatchObject({ statusCode: 404 });
    await expect(
      dismissSupersession.run({ decisionId: "missing" }),
    ).rejects.toThrow("Decision not found: missing");
  });

  it("gr-wim.3: refuses a decision with no supersession pending, with no-supersession", async () => {
    await anAnswerChangeFixture();

    await expect(
      dismissSupersession.run({ decisionId: "d-x" }),
    ).rejects.toMatchObject({ errorCode: "no-supersession", statusCode: 409 });
  });

  it("gr-wim.3 row 3: clears a loose end's answered-by and remembers its dismissal, leaving the spec current", async () => {
    await anAnswerChangeFixture();
    await pointLooseEndAtV();

    await dismissSupersession.run({ decisionId: "d-y" });

    expect(await readDecision("d-y")).toMatchObject({
      proposalKind: null,
      supersededById: null,
      supersessionAnswer: null,
      supersessionReason: null,
      answerKind: "unknown",
    });
    expect(await dismissalsOf("d-y")).toEqual([
      {
        kind: "answered-by",
        targetId: "d-v",
        reason: "r",
        dismissedAt: expect.any(String),
      },
    ]);
    expect(await getDb().select().from(schema.decisionHistory)).toEqual([]);
    expect((await readSpec()).current).toBe(true);
  });

  it("gr-wim.3 row 4: clears a replacement and remembers its dismissal, keeping the answer and leaving the spec current", async () => {
    await anAnswerChangeFixture(REPLACEMENT);

    await dismissSupersession.run({ decisionId: "d-x" });

    expect(await readDecision("d-x")).toMatchObject({
      proposalKind: null,
      supersededById: null,
      supersessionReason: null,
      currentAnswer: "A",
      answerKind: "own-answer",
      settledAt: NOW_STAMP,
      replacedById: null,
    });
    expect(await dismissalsOf("d-x")).toEqual([
      {
        kind: "replacement",
        targetId: "d-v",
        reason: "r",
        dismissedAt: expect.any(String),
      },
    ]);
    expect(await getDb().select().from(schema.decisionHistory)).toEqual([]);
    expect((await readSpec()).current).toBe(true);
  });

  it("gr-wim.3 row 7: refuses a loose end's answered-by while the interviewer is working, writing nothing", async () => {
    await anAnswerChangeFixture({}, { turnWorking: true });
    await pointLooseEndAtV();

    await expectTurnLockRefusal(
      () => dismissSupersession.run({ decisionId: "d-y" }),
      LOCK_MESSAGE,
    );
  });

  it("gr-wim.3 row 7: refuses a replacement while the interviewer is working, writing nothing", async () => {
    await anAnswerChangeFixture(REPLACEMENT, { turnWorking: true });

    await expectTurnLockRefusal(
      () => dismissSupersession.run({ decisionId: "d-x" }),
      LOCK_MESSAGE,
    );
  });

  it("gr-wim.3 row 8: refuses no-supersession before checking the turn lock", async () => {
    await anAnswerChangeFixture({}, { turnWorking: true });

    await expect(
      dismissSupersession.run({ decisionId: "d-x" }),
    ).rejects.toMatchObject({ errorCode: "no-supersession", statusCode: 409 });
  });

  it.each([
    [
      "deferral",
      { proposalKind: "deferral" as const, deferralReason: "later" },
    ],
    [
      "restatement",
      {
        proposalKind: "restatement" as const,
        restatementText: "A clean",
        restatementNotes: "n",
        restatementReason: "r",
      },
    ],
  ])(
    "gr-wim.3 row 9: refuses a pending %s with no-supersession, changing nothing",
    async (_kind, seed) => {
      await anAnswerChangeFixture(seed);
      const before = await readDecision("d-x");

      await expect(
        dismissSupersession.run({ decisionId: "d-x" }),
      ).rejects.toMatchObject({ errorCode: "no-supersession", statusCode: 409 });
      expect(await readDecision("d-x")).toEqual(before);
    },
  );

  it("gr-wim.3 row 10: refuses a stale supersededById with no stored kind, with no-supersession", async () => {
    await anAnswerChangeFixture({ proposalKind: null, supersededById: "d-v" });

    await expect(
      dismissSupersession.run({ decisionId: "d-x" }),
    ).rejects.toMatchObject({ errorCode: "no-supersession", statusCode: 409 });
  });

  it("gr-wim.3 row 12: dismisses a pending replacement whose reason is null", async () => {
    await anAnswerChangeFixture({ ...REPLACEMENT, supersessionReason: null });

    await dismissSupersession.run({ decisionId: "d-x" });

    expect(await readDecision("d-x")).toMatchObject({ proposalKind: null });
    expect(await dismissalsOf("d-x")).toEqual([
      {
        kind: "replacement",
        targetId: "d-v",
        reason: null,
        dismissedAt: expect.any(String),
      },
    ]);
  });
});
