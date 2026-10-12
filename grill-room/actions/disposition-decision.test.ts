import { eq } from "@agent-native/core/db/schema";
import { describe, expect, it } from "vitest";

import { describeDecisions } from "../server/tree.js";
import { getDb, schema, useTestDatabase } from "../test/db.js";
import addDecision from "./add-decision.js";
import createSession from "./create-session.js";
import dispositionDecision from "./disposition-decision.js";
import getTree from "./get-tree.js";
import reopenDecision from "./reopen-decision.js";

function aSession() {
  return createSession.run({
    title: "Grill Room",
    idea: "A local app that grills me about an idea until it is decided.",
  });
}

/** Inserts a decision row directly, bypassing the interviewer and any round. */
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

describe("disposition-decision", () => {
  useTestDatabase();

  it("throws for a decision id that does not exist", async () => {
    await expect(
      dispositionDecision.run({ decisionId: "missing", target: "out-of-scope" }),
    ).rejects.toThrow("Decision not found: missing");
  });

  it("dispositions a loose end out of scope", async () => {
    const session = await aSession();
    await insertDecision(session.id, {
      id: "d-unknown",
      key: "unknown-key",
      questionTitle: "What theme?",
      answerKind: "unknown",
      currentAnswer: "Not sure",
    });

    const result = await dispositionDecision.run({
      decisionId: "d-unknown",
      target: "out-of-scope",
      note: "Theming is a later concern.",
    });

    expect(result).toMatchObject({
      state: "settled",
      answer: { kind: "dispositioned", text: "Theming is a later concern." },
      dispositionTarget: "out-of-scope",
    });
  });

  it("dispositions a loose end as an open question, defaulting the note to empty", async () => {
    const session = await aSession();
    await insertDecision(session.id, {
      id: "d-deferred",
      key: "deferred-key",
      questionTitle: "Which auth provider?",
      answerKind: "deferred",
    });

    const result = await dispositionDecision.run({
      decisionId: "d-deferred",
      target: "open-question",
    });

    expect(result).toMatchObject({
      answer: { kind: "dispositioned", text: "" },
      dispositionTarget: "open-question",
    });
  });

  it("unblocks a dependent once its blocking decision is dispositioned", async () => {
    const session = await aSession();
    await insertDecision(session.id, {
      id: "d-base",
      key: "base-key",
      questionTitle: "Which platform?",
      answerKind: "prototype-flagged",
    });
    await insertDecision(session.id, {
      id: "d-dependent",
      key: "dependent-key",
      questionTitle: "Which framework?",
      dependsOnJson: JSON.stringify(["d-base"]),
    });

    await dispositionDecision.run({
      decisionId: "d-base",
      target: "out-of-scope",
    });

    const tree = await getTree.run({ sessionId: session.id });
    expect(
      tree.decisions.map((decision) => [decision.key, decision.state]),
    ).toEqual([
      ["base-key", "settled"],
      ["dependent-key", "frontier"],
    ]);
  });

  it("refuses a decision that already has a real answer", async () => {
    const session = await aSession();
    const now = new Date().toISOString();
    await insertDecision(session.id, {
      id: "d-settled",
      key: "settled-key",
      questionTitle: "Settled",
      answerKind: "own-answer",
      currentAnswer: "A workspace",
      settledAt: now,
    });

    await expect(
      dispositionDecision.run({ decisionId: "d-settled", target: "out-of-scope" }),
    ).rejects.toThrow(/not a loose end/);
  });

  it("refuses a stale decision", async () => {
    const session = await aSession();
    const now = new Date().toISOString();
    await insertDecision(session.id, {
      id: "d-base",
      key: "base-key",
      questionTitle: "Base",
      answerKind: "own-answer",
      currentAnswer: "A workspace",
      settledAt: now,
    });
    await insertDecision(session.id, {
      id: "d-dependent",
      key: "dependent-key",
      questionTitle: "Dependent",
      answerKind: "own-answer",
      currentAnswer: "On disk",
      settledAt: now,
      dependsOnJson: JSON.stringify(["d-base"]),
    });
    await reopenDecision.run({ decisionId: "d-base" });

    await expect(
      dispositionDecision.run({ decisionId: "d-dependent", target: "out-of-scope" }),
    ).rejects.toThrow(/is stale/);
  });

  it("refuses an unplaced decision", async () => {
    const session = await aSession();
    const added = await addDecision.run({
      sessionId: session.id,
      title: "Should we support offline mode?",
    });

    await expect(
      dispositionDecision.run({ decisionId: added.id, target: "out-of-scope" }),
    ).rejects.toThrow(/awaiting the interviewer's placement/);
  });

  it("refuses an unknown disposition target", async () => {
    const session = await aSession();
    await insertDecision(session.id, {
      id: "d-unknown",
      key: "unknown-key",
      questionTitle: "What theme?",
      answerKind: "unknown",
    });

    await expect(
      dispositionDecision.run({
        decisionId: "d-unknown",
        target: "not-a-real-target" as unknown as "out-of-scope",
      }),
    ).rejects.toThrow();
  });

  it("refuses a decision that is not a loose end before checking the turn lock", async () => {
    const session = await aSession();
    await insertDecision(session.id, {
      id: "d-settled",
      key: "settled-key",
      questionTitle: "Settled",
      answerKind: "own-answer",
      currentAnswer: "A workspace",
      settledAt: new Date().toISOString(),
    });
    await getDb()
      .update(schema.sessions)
      .set({ turnStatus: "working", turnStartedAt: new Date().toISOString() })
      .where(eq(schema.sessions.id, session.id));

    await expect(
      dispositionDecision.run({ decisionId: "d-settled", target: "out-of-scope" }),
    ).rejects.toMatchObject({ errorCode: "not-a-loose-end", statusCode: 409 });
  });

  it("refuses a stale decision before checking the turn lock", async () => {
    const session = await aSession();
    const now = new Date().toISOString();
    await insertDecision(session.id, {
      id: "d-base",
      key: "base-key",
      questionTitle: "Base",
      answerKind: "own-answer",
      currentAnswer: "A workspace",
      settledAt: now,
    });
    await insertDecision(session.id, {
      id: "d-dependent",
      key: "dependent-key",
      questionTitle: "Dependent",
      answerKind: "own-answer",
      currentAnswer: "On disk",
      settledAt: now,
      dependsOnJson: JSON.stringify(["d-base"]),
    });
    await reopenDecision.run({ decisionId: "d-base" });
    await getDb()
      .update(schema.sessions)
      .set({ turnStatus: "working", turnStartedAt: new Date().toISOString() })
      .where(eq(schema.sessions.id, session.id));

    await expect(
      dispositionDecision.run({ decisionId: "d-dependent", target: "out-of-scope" }),
    ).rejects.toMatchObject({ errorCode: "decision-stale", statusCode: 409 });
  });

  it("refuses an unplaced decision before checking the turn lock", async () => {
    const session = await aSession();
    const added = await addDecision.run({
      sessionId: session.id,
      title: "Should we support offline mode?",
    });
    await getDb()
      .update(schema.sessions)
      .set({ turnStatus: "working", turnStartedAt: new Date().toISOString() })
      .where(eq(schema.sessions.id, session.id));

    await expect(
      dispositionDecision.run({ decisionId: added.id, target: "out-of-scope" }),
    ).rejects.toMatchObject({ errorCode: "decision-unplaced", statusCode: 409 });
  });

  it("refuses while the interviewer is working, writing nothing", async () => {
    const session = await aSession();
    await insertDecision(session.id, {
      id: "d-unknown",
      key: "unknown-key",
      questionTitle: "What theme?",
      answerKind: "unknown",
      currentAnswer: "Not sure",
    });
    await getDb()
      .update(schema.sessions)
      .set({ turnStatus: "working", turnStartedAt: new Date().toISOString() })
      .where(eq(schema.sessions.id, session.id));
    const [before] = await getDb()
      .select()
      .from(schema.decisions)
      .where(eq(schema.decisions.id, "d-unknown"));

    const refusal = dispositionDecision.run({ decisionId: "d-unknown", target: "out-of-scope" });

    await expect(refusal).rejects.toMatchObject({
      errorCode: "turn-in-progress",
      statusCode: 409,
    });
    await expect(refusal).rejects.toThrow(
      "The interviewer is working on this session. Wait for the turn to finish before dispositioning a decision.",
    );
    expect(
      await getDb()
        .select()
        .from(schema.decisionHistory)
        .where(eq(schema.decisionHistory.decisionId, "d-unknown")),
    ).toEqual([]);
    const [after] = await getDb()
      .select()
      .from(schema.decisions)
      .where(eq(schema.decisions.id, "d-unknown"));
    expect(after).toEqual(before);
  });

  it("applies the answer change rule", async () => {
    const session = await aSession();
    await getDb()
      .update(schema.sessions)
      .set({ state: "done-proposed", doneSummary: "Nothing left." })
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
    await insertDecision(session.id, {
      id: "d-x",
      key: "x-key",
      questionTitle: "X",
      answerKind: "deferred",
      currentAnswer: "Later",
    });
    await insertDecision(session.id, {
      id: "d-y",
      key: "y-key",
      questionTitle: "Y",
      supersededById: "d-x",
      supersessionAnswer: "Answered by x",
      supersessionReason: "x covers it",
    });
    await insertDecision(session.id, {
      id: "d-z",
      key: "z-key",
      questionTitle: "Z",
      replacedById: "d-x",
      replacedReason: "x replaced it",
    });
    await insertDecision(session.id, {
      id: "d-never",
      key: "never-key",
      questionTitle: "Never answered",
    });

    const result = await dispositionDecision.run({
      decisionId: "d-x",
      target: "out-of-scope",
      note: "Later concern.",
    });
    await dispositionDecision.run({ decisionId: "d-never", target: "open-question" });

    const rows = await getDb().select().from(schema.decisions);
    const byId = (id: string) => rows.find((decision) => decision.id === id)!;
    expect(byId("d-y")).toMatchObject({
      supersededById: null,
      supersessionAnswer: null,
      supersessionReason: null,
    });
    expect(byId("d-z")).toMatchObject({ replacedById: null, replacedReason: null });
    const [spec] = await getDb()
      .select()
      .from(schema.specs)
      .where(eq(schema.specs.sessionId, session.id));
    expect(spec).toMatchObject({ current: false });
    expect(result).toEqual(describeDecisions([byId("d-x")])[0]);
    expect(byId("d-never")).toMatchObject({
      answerKind: "dispositioned",
      dispositionTarget: "open-question",
    });
    expect(
      await getDb()
        .select()
        .from(schema.decisionHistory)
        .where(eq(schema.decisionHistory.decisionId, "d-never")),
    ).toEqual([]);
  });
});
