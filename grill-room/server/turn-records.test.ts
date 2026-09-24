import { eq } from "@agent-native/core/db/schema";
import { describe, expect, it } from "vitest";

import createSession from "../actions/create-session.js";
import { getDb, schema, useTestDatabase } from "../test/db.js";
import {
  addRun,
  completeAttempt,
  completeTurn,
  createTurn,
  getTurnWithRuns,
  startAttempt,
} from "./turn-records.js";

async function aSession(): Promise<string> {
  const session = await createSession.run({
    title: "Grill Room",
    idea: "A local app that grills me about an idea until it is decided.",
  });
  return session.id;
}

describe("turn-records", () => {
  useTestDatabase();

  it("creates a turn with its first run", async () => {
    const sessionId = await aSession();
    const { turnId, runId } = await createTurn({
      sessionId,
      turnKind: "propose-round",
      model: "fable",
    });

    const turn = await getTurnWithRuns(turnId);
    expect(turn).toMatchObject({
      id: turnId,
      sessionId,
      turnKind: "propose-round",
      model: "fable",
      completedAt: null,
      totalElapsedMs: null,
      outcome: null,
    });
    expect(turn?.runs).toEqual([
      { id: runId, runNumber: 1, manualRetry: false, createdAt: expect.any(String), attempts: [] },
    ]);
  });

  it("records a clean turn as exactly one successful attempt, then completes the turn", async () => {
    const sessionId = await aSession();
    const { turnId, runId } = await createTurn({
      sessionId,
      turnKind: "propose-round",
      model: "opus",
    });

    const { attemptId, attemptNumber } = await startAttempt(runId);
    expect(attemptNumber).toBe(1);

    await completeAttempt({
      attemptId,
      kind: "success",
      rawOutput: '{"round":"proposal"}',
    });
    await completeTurn({ turnId, outcome: "succeeded" });

    const turn = await getTurnWithRuns(turnId);
    expect(turn?.outcome).toBe("succeeded");
    expect(turn?.completedAt).not.toBeNull();
    expect(turn?.totalElapsedMs).not.toBeNull();
    expect(turn?.totalElapsedMs).toBeGreaterThanOrEqual(0);

    expect(turn?.runs).toHaveLength(1);
    const [run] = turn!.runs;
    expect(run?.attempts).toHaveLength(1);
    expect(run?.attempts[0]).toMatchObject({
      id: attemptId,
      attemptNumber: 1,
      kind: "success",
      reason: null,
      rawOutput: '{"round":"proposal"}',
    });
    expect(run?.attempts[0]?.durationMs).not.toBeNull();
    expect(run?.attempts[0]?.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("numbers refusals upward within a run, with kind and reason intact, then the success", async () => {
    const sessionId = await aSession();
    const { turnId, runId } = await createTurn({
      sessionId,
      turnKind: "propose-round",
      model: "fable",
    });

    const first = await startAttempt(runId);
    await completeAttempt({
      attemptId: first.attemptId,
      kind: "tree-rule-refusal",
      reason: "Off-frontier question: asked about a decision not yet unblocked.",
    });

    const second = await startAttempt(runId);
    expect(second.attemptNumber).toBe(2);
    await completeAttempt({
      attemptId: second.attemptId,
      kind: "schema-invalid",
      reason: "The model's output did not match the expected schema.",
    });

    const third = await startAttempt(runId);
    expect(third.attemptNumber).toBe(3);
    await completeAttempt({
      attemptId: third.attemptId,
      kind: "success",
      rawOutput: '{"ok":true}',
    });
    await completeTurn({ turnId, outcome: "succeeded" });

    const turn = await getTurnWithRuns(turnId);
    expect(turn?.runs).toHaveLength(1);
    expect(turn?.runs[0]?.attempts.map((a) => a.attemptNumber)).toEqual([1, 2, 3]);
    expect(turn?.runs[0]?.attempts[0]).toMatchObject({
      kind: "tree-rule-refusal",
      reason: "Off-frontier question: asked about a decision not yet unblocked.",
    });
    expect(turn?.runs[0]?.attempts[1]).toMatchObject({
      kind: "schema-invalid",
      reason: "The model's output did not match the expected schema.",
    });
    expect(turn?.runs[0]?.attempts[2]).toMatchObject({
      kind: "success",
      rawOutput: '{"ok":true}',
    });
  });

  it("keeps every attempt when a turn stops with an exhausted budget", async () => {
    const sessionId = await aSession();
    const { turnId, runId } = await createTurn({
      sessionId,
      turnKind: "propose-round",
      model: "fable",
    });

    for (const reason of ["Unknown key.", "Duplicate title.", "Cycle detected."]) {
      const { attemptId } = await startAttempt(runId);
      await completeAttempt({ attemptId, kind: "tree-rule-refusal", reason });
    }
    await completeTurn({ turnId, outcome: "invalid-proposal" });

    const turn = await getTurnWithRuns(turnId);
    expect(turn?.outcome).toBe("invalid-proposal");
    expect(turn?.runs[0]?.attempts).toHaveLength(3);
    expect(turn?.runs[0]?.attempts.every((a) => a.kind === "tree-rule-refusal")).toBe(true);
  });

  it("records a resume fallback as its own attempt kind", async () => {
    const sessionId = await aSession();
    const { turnId, runId } = await createTurn({
      sessionId,
      turnKind: "propose-round",
      model: "fable",
    });

    const fallback = await startAttempt(runId);
    await completeAttempt({
      attemptId: fallback.attemptId,
      kind: "resume-fallback",
      reason: "Resuming the conversation failed; started a fresh, primed conversation.",
    });
    const success = await startAttempt(runId);
    await completeAttempt({ attemptId: success.attemptId, kind: "success" });
    await completeTurn({ turnId, outcome: "succeeded" });

    const turn = await getTurnWithRuns(turnId);
    expect(turn?.runs[0]?.attempts.map((a) => a.kind)).toEqual([
      "resume-fallback",
      "success",
    ]);
  });

  it("records a rate limit as its own kind, distinct from an interviewer error", async () => {
    const sessionId = await aSession();
    const { turnId, runId } = await createTurn({
      sessionId,
      turnKind: "propose-round",
      model: "fable",
    });

    const { attemptId } = await startAttempt(runId);
    await completeAttempt({
      attemptId,
      kind: "rate-limit",
      reason: "The shared subscription's usage is exhausted for now.",
    });
    await completeTurn({ turnId, outcome: "rate-limited" });

    const turn = await getTurnWithRuns(turnId);
    expect(turn?.outcome).toBe("rate-limited");
    expect(turn?.runs[0]?.attempts[0]?.kind).toBe("rate-limit");
  });

  it("adds a manual retry as a new run, numbered after the turn's runs, with the budget restarting at 1", async () => {
    const sessionId = await aSession();
    const { turnId, runId: firstRunId } = await createTurn({
      sessionId,
      turnKind: "propose-round",
      model: "fable",
    });
    const firstAttempt = await startAttempt(firstRunId);
    await completeAttempt({
      attemptId: firstAttempt.attemptId,
      kind: "schema-invalid",
      reason: "Bad output.",
    });
    await completeTurn({ turnId, outcome: "schema-invalid" });

    const { runId: secondRunId, runNumber } = await addRun(turnId);
    expect(runNumber).toBe(2);

    const retryAttempt = await startAttempt(secondRunId);
    expect(retryAttempt.attemptNumber).toBe(1);
    await completeAttempt({ attemptId: retryAttempt.attemptId, kind: "success" });
    await completeTurn({ turnId, outcome: "succeeded" });

    const turn = await getTurnWithRuns(turnId);
    expect(turn?.runs.map((r) => ({ runNumber: r.runNumber, manualRetry: r.manualRetry }))).toEqual([
      { runNumber: 1, manualRetry: false },
      { runNumber: 2, manualRetry: true },
    ]);
    expect(turn?.runs[1]?.attempts.map((a) => a.attemptNumber)).toEqual([1]);
    expect(turn?.outcome).toBe("succeeded");
  });

  it("stores and reads back a turn kind the schema has never seen, with no migration", async () => {
    const sessionId = await aSession();
    const { turnId } = await createTurn({
      sessionId,
      turnKind: "project-scout",
      model: "sonnet",
    });

    const turn = await getTurnWithRuns(turnId);
    expect(turn?.turnKind).toBe("project-scout");
    expect(turn?.model).toBe("sonnet");
  });

  it("stores and reads back the model on every turn", async () => {
    const sessionId = await aSession();
    for (const model of ["fable", "opus", "sonnet"]) {
      const { turnId } = await createTurn({ sessionId, turnKind: "assess-readiness", model });
      const turn = await getTurnWithRuns(turnId);
      expect(turn?.model).toBe(model);
    }
  });

  it("reads back null for a turn id that does not exist", async () => {
    expect(await getTurnWithRuns("missing")).toBeNull();
  });

  it("leaves rounds, specs and the session's readiness with no turn record by default", async () => {
    const sessionId = await aSession();
    const now = new Date().toISOString();

    await getDb()
      .insert(schema.rounds)
      .values({ id: "round-1", sessionId, createdAt: now });
    await getDb()
      .insert(schema.specs)
      .values({ id: "spec-1", sessionId, markdown: "# Spec", createdAt: now, updatedAt: now });

    const [round] = await getDb()
      .select()
      .from(schema.rounds)
      .where(eq(schema.rounds.id, "round-1"));
    const [spec] = await getDb()
      .select()
      .from(schema.specs)
      .where(eq(schema.specs.id, "spec-1"));
    const [session] = await getDb()
      .select()
      .from(schema.sessions)
      .where(eq(schema.sessions.id, sessionId));

    expect(round?.turnId).toBeNull();
    expect(spec?.turnId).toBeNull();
    expect(spec?.ticketsTurnId).toBeNull();
    expect(session?.readinessTurnId).toBeNull();
    expect(session?.staleReviewTurnId).toBeNull();
    expect(session?.supersessionTurnId).toBeNull();
  });

  it("links a round to a turn record and reads it back", async () => {
    const sessionId = await aSession();
    const { turnId } = await createTurn({
      sessionId,
      turnKind: "propose-round",
      model: "fable",
    });
    const now = new Date().toISOString();

    await getDb()
      .insert(schema.rounds)
      .values({ id: "round-2", sessionId, turnId, createdAt: now });

    const [round] = await getDb()
      .select()
      .from(schema.rounds)
      .where(eq(schema.rounds.id, "round-2"));

    expect(round?.turnId).toBe(turnId);
  });
});
