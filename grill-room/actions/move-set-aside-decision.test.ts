import { eq } from "@agent-native/core/db/schema";
import { describe, expect, it } from "vitest";

import { describeDecisions } from "../server/tree.js";
import { getDb, schema, useTestDatabase } from "../test/db.js";
import createSession from "./create-session.js";
import moveSetAsideDecision from "./move-set-aside-decision.js";

const SETTLED_AT = "2026-10-01T00:00:00.000Z";

type Target = "out-of-scope" | "open-question" | "builders-call";

function aSession() {
  return createSession.run({
    title: "Grill Room",
    idea: "A local app that grills me about an idea until it is decided.",
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

/** Row 6's decision: set aside, with a note and a pending supersession. */
async function setAside(
  sessionId: string,
  target: Target,
  overrides: Partial<
    Omit<typeof schema.decisions.$inferInsert, "id" | "key" | "questionTitle">
  > = {},
) {
  await insertDecision(sessionId, {
    id: "d-x",
    key: "x-key",
    questionTitle: "Where does the data live?",
    answerKind: "dispositioned",
    dispositionTarget: target,
    currentAnswer: "N",
    settledAt: SETTLED_AT,
    updatedAt: SETTLED_AT,
    settledById: "d-other",
    supersededById: "d-x",
    proposalKind: "answered-by",
    supersessionAnswer: "Somewhere else",
    ...overrides,
  });
}

async function rowOf(id: string) {
  const [row] = await getDb().select().from(schema.decisions).where(eq(schema.decisions.id, id));
  return row!;
}

async function setTurnWorking(sessionId: string) {
  await getDb()
    .update(schema.sessions)
    .set({ turnStatus: "working", turnStartedAt: new Date().toISOString() })
    .where(eq(schema.sessions.id, sessionId));
}

async function expectRefusal(
  input: { decisionId: string; target: Target },
  refusal: { errorCode: string; statusCode: number; message: string },
) {
  const before = await getDb().select().from(schema.decisions);
  await expect(moveSetAsideDecision.run(input)).rejects.toMatchObject(refusal);
  expect(await getDb().select().from(schema.decisions)).toEqual(before);
}

describe("move-set-aside-decision", () => {
  useTestDatabase();

  it("row 6: changes only the target and updatedAt, and returns the described decision", async () => {
    const session = await aSession();
    await setAside(session.id, "builders-call");
    const before = await rowOf("d-x");

    const result = await moveSetAsideDecision.run({ decisionId: "d-x", target: "open-question" });

    const after = await rowOf("d-x");
    expect(after.updatedAt).not.toBe(SETTLED_AT);
    expect(after).toEqual({ ...before, dispositionTarget: "open-question", updatedAt: after.updatedAt });
    expect(result).toEqual(describeDecisions([after])[0]);
  });

  it("row 7: moves an open question to a builder's call", async () => {
    const session = await aSession();
    await setAside(session.id, "open-question");
    const before = await rowOf("d-x");

    await moveSetAsideDecision.run({ decisionId: "d-x", target: "builders-call" });

    const after = await rowOf("d-x");
    expect(after).toEqual({ ...before, dispositionTarget: "builders-call", updatedAt: after.updatedAt });
    expect(after.updatedAt).not.toBe(SETTLED_AT);
  });

  it("row 8: moves an out-of-scope decision to a builder's call", async () => {
    const session = await aSession();
    await setAside(session.id, "out-of-scope");
    const before = await rowOf("d-x");

    await moveSetAsideDecision.run({ decisionId: "d-x", target: "builders-call" });

    const after = await rowOf("d-x");
    expect(after).toEqual({ ...before, dispositionTarget: "builders-call", updatedAt: after.updatedAt });
    expect(after.updatedAt).not.toBe(SETTLED_AT);
  });

  it("row 9: refuses an id that does not exist", async () => {
    await expectRefusal(
      { decisionId: "missing", target: "open-question" },
      { errorCode: "not-found", statusCode: 404 , message: "Decision not found: missing" },
    );
  });

  it("row 10: refuses a settled own answer", async () => {
    const session = await aSession();
    await insertDecision(session.id, {
      id: "d-own",
      key: "own-key",
      questionTitle: "Own",
      answerKind: "own-answer",
      currentAnswer: "Mine",
      settledAt: SETTLED_AT,
    });

    await expectRefusal(
      { decisionId: "d-own", target: "builders-call" },
      { errorCode: "not-set-aside", statusCode: 409 , message: `"Own" is not a settled set-aside decision, so there is no target to move.` },
    );
  });

  it("row 11: refuses a loose end", async () => {
    const session = await aSession();
    await insertDecision(session.id, {
      id: "d-unknown",
      key: "unknown-key",
      questionTitle: "Unknown",
      answerKind: "unknown",
      currentAnswer: "Not sure",
    });

    await expectRefusal(
      { decisionId: "d-unknown", target: "builders-call" },
      { errorCode: "not-set-aside", statusCode: 409 , message: `"Unknown" is not a settled set-aside decision, so there is no target to move.` },
    );
  });

  it("row 12: refuses a withdrawn set-aside decision", async () => {
    const session = await aSession();
    await setAside(session.id, "builders-call", { withdrawnAt: "2026-10-02T00:00:00.000Z" });

    await expectRefusal(
      { decisionId: "d-x", target: "open-question" },
      { errorCode: "not-set-aside", statusCode: 409 , message: `"Where does the data live?" is not a settled set-aside decision, so there is no target to move.` },
    );
  });

  it("row 13: refuses an unplaced decision", async () => {
    const session = await aSession();
    await setAside(session.id, "builders-call", { awaitingPlacementSince: "2026-10-02T00:00:00.000Z" });

    await expectRefusal(
      { decisionId: "d-x", target: "open-question" },
      { errorCode: "decision-unplaced", statusCode: 409 , message: `"Where does the data live?" is a user-added decision awaiting the interviewer's placement, so it cannot be moved yet.` },
    );
  });

  it("row 14: refuses a stale set-aside decision", async () => {
    const session = await aSession();
    await insertDecision(session.id, {
      id: "d-dep",
      key: "dep-key",
      questionTitle: "Dependency",
      reopenedAt: "2026-10-02T00:00:00.000Z",
    });
    await setAside(session.id, "builders-call", { dependsOnJson: JSON.stringify(["d-dep"]) });

    await expectRefusal(
      { decisionId: "d-x", target: "open-question" },
      { errorCode: "decision-stale", statusCode: 409 , message: `"Where does the data live?" is stale: the stale review that runs on the next turn resolves it before it can be moved.` },
    );
  });

  it("row 14b: checks the tree state before whether the decision is set aside", async () => {
    const session = await aSession();
    await insertDecision(session.id, {
      id: "d-dep",
      key: "dep-key",
      questionTitle: "Dependency",
      reopenedAt: "2026-10-02T00:00:00.000Z",
    });
    await insertDecision(session.id, {
      id: "d-own",
      key: "own-key",
      questionTitle: "Own",
      answerKind: "own-answer",
      currentAnswer: "Mine",
      settledAt: SETTLED_AT,
      dependsOnJson: JSON.stringify(["d-dep"]),
    });

    await expectRefusal(
      { decisionId: "d-own", target: "builders-call" },
      { errorCode: "decision-stale", statusCode: 409 , message: `"Own" is stale: the stale review that runs on the next turn resolves it before it can be moved.` },
    );
  });

  it("row 15: refuses a move to the target it already has", async () => {
    const session = await aSession();
    await setAside(session.id, "builders-call");

    await expectRefusal(
      { decisionId: "d-x", target: "builders-call" },
      { errorCode: "same-target", statusCode: 409 , message: `"Where does the data live?" is already set aside as builders-call.` },
    );
  });

  it("row 15b: checks the target before the turn lock", async () => {
    const session = await aSession();
    await setAside(session.id, "builders-call");
    await setTurnWorking(session.id);

    await expectRefusal(
      { decisionId: "d-x", target: "builders-call" },
      { errorCode: "same-target", statusCode: 409 , message: `"Where does the data live?" is already set aside as builders-call.` },
    );
  });

  it("row 16: refuses while a turn is working", async () => {
    const session = await aSession();
    await setAside(session.id, "builders-call");
    await setTurnWorking(session.id);

    await expectRefusal(
      { decisionId: "d-x", target: "open-question" },
      { errorCode: "turn-in-progress", statusCode: 409 , message: "The interviewer is working on this session. Wait for the turn to finish before moving a decision." },
    );
  });

  it("row 17: checks the tree before the turn lock", async () => {
    const session = await aSession();
    await insertDecision(session.id, {
      id: "d-own",
      key: "own-key",
      questionTitle: "Own",
      answerKind: "own-answer",
      currentAnswer: "Mine",
      settledAt: SETTLED_AT,
    });
    await setTurnWorking(session.id);

    await expectRefusal(
      { decisionId: "d-own", target: "builders-call" },
      { errorCode: "not-set-aside", statusCode: 409 , message: `"Own" is not a settled set-aside decision, so there is no target to move.` },
    );
  });

  it("row 18: leaves a settled dependent settled", async () => {
    const session = await aSession();
    await setAside(session.id, "builders-call");
    await insertDecision(session.id, {
      id: "d-dependent",
      key: "dependent-key",
      questionTitle: "Dependent",
      answerKind: "own-answer",
      currentAnswer: "Yes",
      settledAt: "2026-10-02T00:00:00.000Z",
      dependsOnJson: JSON.stringify(["d-x"]),
    });

    await moveSetAsideDecision.run({ decisionId: "d-x", target: "open-question" });

    const rows = await getDb().select().from(schema.decisions);
    const dependent = describeDecisions(rows).find((row) => row.id === "d-dependent");
    expect(dependent?.state).toBe("settled");
    expect((await rowOf("d-x")).reopenedAt).toBeNull();
  });

  it("row 19: keeps a confirmed session confirmed and marks its spec not current", async () => {
    const session = await aSession();
    await getDb()
      .update(schema.sessions)
      .set({ state: "confirmed" })
      .where(eq(schema.sessions.id, session.id));
    const now = new Date().toISOString();
    await getDb().insert(schema.specs).values({
      id: "spec-1",
      sessionId: session.id,
      markdown: "# Grill Room\n",
      current: true,
      createdAt: now,
      updatedAt: now,
    });
    await setAside(session.id, "builders-call");

    await moveSetAsideDecision.run({ decisionId: "d-x", target: "open-question" });

    const [after] = await getDb().select().from(schema.sessions).where(eq(schema.sessions.id, session.id));
    expect(after?.state).toBe("confirmed");
    const [spec] = await getDb().select().from(schema.specs).where(eq(schema.specs.sessionId, session.id));
    expect(spec?.current).toBe(false);
  });

  it("row 20: writes no history", async () => {
    const session = await aSession();
    await setAside(session.id, "builders-call");

    await moveSetAsideDecision.run({ decisionId: "d-x", target: "open-question" });

    expect(await getDb().select().from(schema.decisionHistory)).toEqual([]);
  });
});
