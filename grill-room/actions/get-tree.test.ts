import { eq } from "@agent-native/core/db/schema";
import { describe, expect, it } from "vitest";

import type { DecisionAnswerKind } from "../server/db/schema.js";
import { getDb, schema, useTestDatabase } from "../test/db.js";
import createSession from "./create-session.js";
import getTree from "./get-tree.js";

/**
 * The tree's states are derived from facts no action writes yet — a reopen, an
 * answer that does not settle — so these tests arrange rows directly. Every
 * other behaviour in this file goes through actions.
 */
async function arrangeDecision(
  sessionId: string,
  decision: {
    id: string;
    key: string;
    dependsOn?: string[];
    answerKind?: DecisionAnswerKind | null;
    answer?: string | null;
    dispositionTarget?: "out-of-scope" | "open-question" | null;
    settledAt?: string | null;
    reopenedAt?: string | null;
    withdrawnAt?: string | null;
    awaitingPlacementSince?: string | null;
    introducedBy?: "interviewer" | "user";
    createdAt: string;
  },
) {
  await getDb()
    .insert(schema.decisions)
    .values({
      id: decision.id,
      sessionId,
      key: decision.key,
      questionTitle: `Question ${decision.key}`,
      dependsOnJson: JSON.stringify(decision.dependsOn ?? []),
      answerKind: decision.answerKind ?? null,
      currentAnswer: decision.answer ?? null,
      dispositionTarget: decision.dispositionTarget ?? null,
      settledAt: decision.settledAt ?? null,
      reopenedAt: decision.reopenedAt ?? null,
      withdrawnAt: decision.withdrawnAt ?? null,
      awaitingPlacementSince: decision.awaitingPlacementSince ?? null,
      introducedBy: decision.introducedBy ?? "interviewer",
      createdAt: decision.createdAt,
      updatedAt: decision.createdAt,
    });
}

function aSession() {
  return createSession.run({
    title: "Grill Room",
    idea: "A local app that grills me about an idea until it is decided.",
  });
}

async function statesOf(sessionId: string) {
  const tree = await getTree.run({ sessionId });
  return Object.fromEntries(
    tree.decisions.map((decision) => [decision.key, decision.state]),
  );
}

describe("get-tree", () => {
  useTestDatabase();

  it("throws for a session id that does not exist", async () => {
    await expect(getTree.run({ sessionId: "missing" })).rejects.toThrow(
      "Session not found: missing",
    );
  });

  it("is empty for a session that has not been interviewed yet", async () => {
    const session = await aSession();

    expect(await getTree.run({ sessionId: session.id })).toEqual({
      sessionId: session.id,
      decisions: [],
    });
  });

  it("reports what each decision depends on, by id", async () => {
    const session = await aSession();
    await arrangeDecision(session.id, {
      id: "a",
      key: "shape",
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    await arrangeDecision(session.id, {
      id: "b",
      key: "storage",
      dependsOn: ["a"],
      createdAt: "2026-01-01T00:00:01.000Z",
    });

    const tree = await getTree.run({ sessionId: session.id });

    expect(tree.decisions.map((decision) => decision.dependsOn)).toEqual([
      [],
      ["a"],
    ]);
  });

  it("settles a decision that has a real answer and opens the frontier behind it", async () => {
    const session = await aSession();
    await arrangeDecision(session.id, {
      id: "a",
      key: "shape",
      answerKind: "own-answer",
      answer: "A workspace",
      settledAt: "2026-01-01T00:00:00.000Z",
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    await arrangeDecision(session.id, {
      id: "b",
      key: "storage",
      dependsOn: ["a"],
      createdAt: "2026-01-01T00:00:01.000Z",
    });
    await arrangeDecision(session.id, {
      id: "c",
      key: "sync",
      dependsOn: ["b"],
      createdAt: "2026-01-01T00:00:02.000Z",
    });

    expect(await statesOf(session.id)).toEqual({
      shape: "settled",
      storage: "frontier",
      sync: "blocked",
    });
  });

  it("counts a disposition as a real answer and an unknown as no answer", async () => {
    const session = await aSession();
    await arrangeDecision(session.id, {
      id: "a",
      key: "shape",
      answerKind: "dispositioned",
      dispositionTarget: "out-of-scope",
      settledAt: "2026-01-01T00:00:00.000Z",
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    await arrangeDecision(session.id, {
      id: "b",
      key: "tone",
      answerKind: "unknown",
      answer: "No idea yet",
      settledAt: "2026-01-01T00:00:00.000Z",
      createdAt: "2026-01-01T00:00:01.000Z",
    });
    await arrangeDecision(session.id, {
      id: "c",
      key: "voice",
      dependsOn: ["b"],
      createdAt: "2026-01-01T00:00:02.000Z",
    });

    expect(await statesOf(session.id)).toEqual({
      shape: "settled",
      tone: "frontier",
      voice: "blocked",
    });
  });

  it("goes stale down the whole chain when a decision is reopened after they settled", async () => {
    const session = await aSession();
    await arrangeDecision(session.id, {
      id: "a",
      key: "shape",
      answerKind: null,
      settledAt: null,
      reopenedAt: "2026-01-02T00:00:00.000Z",
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    await arrangeDecision(session.id, {
      id: "b",
      key: "storage",
      dependsOn: ["a"],
      answerKind: "accepted-recommendation",
      answer: "On disk",
      settledAt: "2026-01-01T00:00:10.000Z",
      createdAt: "2026-01-01T00:00:01.000Z",
    });
    await arrangeDecision(session.id, {
      id: "c",
      key: "sync",
      dependsOn: ["b"],
      answerKind: "own-answer",
      answer: "Poll",
      settledAt: "2026-01-01T00:00:20.000Z",
      createdAt: "2026-01-01T00:00:02.000Z",
    });

    expect(await statesOf(session.id)).toEqual({
      shape: "frontier",
      storage: "stale",
      sync: "stale",
    });
  });

  it("leaves a decision settled when the reopen happened before it settled", async () => {
    const session = await aSession();
    await arrangeDecision(session.id, {
      id: "a",
      key: "shape",
      answerKind: "own-answer",
      answer: "A workspace, after all",
      reopenedAt: "2026-01-01T00:00:00.000Z",
      settledAt: "2026-01-03T00:00:00.000Z",
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    await arrangeDecision(session.id, {
      id: "b",
      key: "storage",
      dependsOn: ["a"],
      answerKind: "own-answer",
      answer: "On disk",
      settledAt: "2026-01-04T00:00:00.000Z",
      createdAt: "2026-01-01T00:00:01.000Z",
    });

    expect(await statesOf(session.id)).toEqual({
      shape: "settled",
      storage: "settled",
    });
  });

  it("reports a withdrawn decision as withdrawn, and a dependency on it as satisfied", async () => {
    const session = await aSession();
    await arrangeDecision(session.id, {
      id: "a",
      key: "shape",
      answerKind: "pushed-back",
      answer: "Too vague.",
      withdrawnAt: "2026-01-01T00:00:00.000Z",
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    await arrangeDecision(session.id, {
      id: "b",
      key: "storage",
      dependsOn: ["a"],
      createdAt: "2026-01-01T00:00:01.000Z",
    });

    expect(await statesOf(session.id)).toEqual({
      shape: "withdrawn",
      storage: "frontier",
    });
  });

  it("carries the question as it read at the time on every previous answer", async () => {
    const session = await aSession();
    await arrangeDecision(session.id, {
      id: "a",
      key: "shape",
      answerKind: "own-answer",
      answer: "A workspace, reworded",
      settledAt: "2026-01-02T00:00:00.000Z",
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    await getDb()
      .update(schema.decisions)
      .set({ questionTitle: "What shape should this take, exactly?" })
      .where(eq(schema.decisions.id, "a"));
    await getDb()
      .insert(schema.decisionHistory)
      .values({
        id: "h1",
        decisionId: "a",
        questionTitle: "What shape should this take?",
        questionBody: "The original body.",
        answer: "A workspace",
        answerKind: "own-answer",
        interviewerReason: "the question needed sharpening",
        recordedAt: "2026-01-01T12:00:00.000Z",
      });

    const tree = await getTree.run({ sessionId: session.id });
    const [decision] = tree.decisions;

    expect(decision?.questionTitle).toBe(
      "What shape should this take, exactly?",
    );
    expect(decision?.previousAnswers).toEqual([
      {
        text: "A workspace",
        kind: "own-answer",
        interviewerReason: "the question needed sharpening",
        operatorNotes: null,
        recordedAt: "2026-01-01T12:00:00.000Z",
        questionTitle: "What shape should this take?",
        questionBody: "The original body.",
      },
    ]);
  });

  it("reports a user-added decision awaiting placement as unplaced, excluded from the frontier", async () => {
    const session = await aSession();
    await arrangeDecision(session.id, {
      id: "a",
      key: "offline-mode",
      introducedBy: "user",
      awaitingPlacementSince: "2026-01-01T00:00:00.000Z",
      createdAt: "2026-01-01T00:00:00.000Z",
    });

    expect(await statesOf(session.id)).toEqual({ "offline-mode": "unplaced" });
  });
});
