import { eq } from "@agent-native/core/db/schema";
import { describe, expect, it } from "vitest";

import { getDb, schema, useTestDatabase } from "../test/db.js";
import acceptSupersession from "./accept-supersession.js";
import answerDecision from "./answer-decision.js";
import createSession from "./create-session.js";
import dismissSupersession from "./dismiss-supersession.js";
import dispositionDecision from "./disposition-decision.js";
import listLooseEnds from "./list-loose-ends.js";
import reopenDecision from "./reopen-decision.js";

/*
 * `dismiss-supersession`, and every other path that has to drop a pending
 * proposal, travel with `accept-supersession`: the harness builds one database
 * per test file, and what they assert is what this action's counterpart wrote.
 */

const REASON = "The shape decision already commits to data on disk.";

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

/** A settled decision, and a loose end carrying a supersession that points at it. */
async function aPendingSupersession(overrides: {
  looseEndKind?: "unknown" | "deferred" | "prototype-flagged" | "pushed-back";
} = {}) {
  const session = await aSession();
  await insertDecision(session.id, {
    id: "d-shape",
    key: "shape",
    questionTitle: "What shape should this take?",
    answerKind: "own-answer",
    currentAnswer: "A workspace whose data lives on disk",
    settledAt: new Date().toISOString(),
  });
  await insertDecision(session.id, {
    id: "d-storage",
    key: "storage",
    questionTitle: "Where does the data live?",
    answerKind: overrides.looseEndKind ?? "unknown",
    currentAnswer: "Not sure yet",
    supersededById: "d-shape",
    supersessionAnswer: "On disk",
    supersessionReason: REASON,
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

describe("accept-supersession", () => {
  useTestDatabase();

  it("throws for a decision id that does not exist", async () => {
    await expect(
      acceptSupersession.run({ decisionId: "missing" }),
    ).rejects.toThrow("Decision not found: missing");
  });

  it("refuses a decision with no supersession pending", async () => {
    const session = await aSession();
    await insertDecision(session.id, {
      id: "d-storage",
      key: "storage",
      questionTitle: "Where does the data live?",
      answerKind: "unknown",
    });

    await expect(
      acceptSupersession.run({ decisionId: "d-storage" }),
    ).rejects.toThrow(/has no supersession to accept/);
  });

  it("settles the loose end with the proposed answer and clears the proposal", async () => {
    const session = await aPendingSupersession();

    const view = await acceptSupersession.run({ decisionId: "d-storage" });

    expect(view).toMatchObject({
      answer: { kind: "own-answer", text: "On disk" },
      supersession: null,
      state: "settled",
    });
    const row = await readDecision("d-storage");
    expect(row).toMatchObject({
      currentAnswer: "On disk",
      answerKind: "own-answer",
      supersededById: null,
      supersessionAnswer: null,
      supersessionReason: null,
    });
    expect(row?.settledAt).not.toBeNull();
    expect(await listLooseEnds.run({ sessionId: session.id })).toEqual([]);
  });

  it("records the steering move it replaced, with the interviewer's reason", async () => {
    await aPendingSupersession();

    await acceptSupersession.run({ decisionId: "d-storage" });

    expect(await historyOf("d-storage")).toMatchObject([
      {
        answer: "Not sure yet",
        answerKind: "unknown",
        interviewerReason: REASON,
      },
    ]);
  });
});

describe("dismiss-supersession", () => {
  useTestDatabase();

  it("refuses a decision with no supersession pending", async () => {
    const session = await aSession();
    await insertDecision(session.id, {
      id: "d-storage",
      key: "storage",
      questionTitle: "Where does the data live?",
      answerKind: "unknown",
    });

    await expect(
      dismissSupersession.run({ decisionId: "d-storage" }),
    ).rejects.toThrow(/has no supersession to dismiss/);
  });

  it("clears the proposal and leaves the loose end exactly as open as it was", async () => {
    const session = await aPendingSupersession();

    const view = await dismissSupersession.run({ decisionId: "d-storage" });

    expect(view).toMatchObject({
      answer: { kind: "unknown", text: "Not sure yet" },
      supersession: null,
    });
    // Nothing was decided, so nothing is recorded as history.
    expect(await historyOf("d-storage")).toEqual([]);
    expect(await listLooseEnds.run({ sessionId: session.id })).toMatchObject([
      { key: "storage", reason: "unknown", supersession: null },
    ]);
  });
});

describe("a pending supersession the user resolves another way", () => {
  useTestDatabase();

  it("is cleared by answering the loose end", async () => {
    await aPendingSupersession();

    const view = await answerDecision.run({
      decisionId: "d-storage",
      answer: "In memory, and that is deliberate",
    });

    expect(view).toMatchObject({
      answer: { kind: "own-answer", text: "In memory, and that is deliberate" },
      supersession: null,
    });
    expect(await readDecision("d-storage")).toMatchObject({
      supersededById: null,
      supersessionAnswer: null,
      supersessionReason: null,
    });
  });

  it("is cleared by setting the loose end aside", async () => {
    await aPendingSupersession();

    const view = await dispositionDecision.run({
      decisionId: "d-storage",
      target: "out-of-scope",
      note: "Not this release.",
    });

    expect(view.supersession).toBeNull();
    expect(await readDecision("d-storage")).toMatchObject({
      supersededById: null,
      supersessionAnswer: null,
    });
  });

  it("is cleared by reopening the decision it claimed had answered it", async () => {
    const session = await aPendingSupersession();

    await reopenDecision.run({ decisionId: "d-shape" });

    expect(await readDecision("d-storage")).toMatchObject({
      supersededById: null,
      supersessionAnswer: null,
      supersessionReason: null,
    });
    const looseEnds = await listLooseEnds.run({ sessionId: session.id });
    expect(
      looseEnds.find((end) => end.key === "storage")?.supersession,
    ).toBeNull();
  });
});
