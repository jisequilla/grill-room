import { eq } from "@agent-native/core/db/schema";
import { describe, expect, it } from "vitest";

import createSession from "../actions/create-session.js";
import { getDb, schema, useTestDatabase } from "../test/db.js";
import type { CliMetrics, ModelCallOutcome } from "./interviewer/index.js";
import {
  resumeOrStartTurnRecorder,
  startTurnRecorder,
  TURN_SUCCEEDED,
  type TurnRecorder,
} from "./turn-recorder.js";
import {
  addRun,
  completeAttempt,
  completeTurn,
  createTurn,
  findRunningTurn,
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

  it("a manual retry joins the outer turn, not a turn nested inside it that finished first", async () => {
    const sessionId = await aSession();

    // The outer turn: a round proposal.
    const outer = await startTurnRecorder({
      sessionId,
      turnKind: "propose-round",
      model: "sonnet",
    });

    // A turn nested inside it — the supersession scan a done proposal runs
    // inside its `propose-round` turn, say. It starts after the outer turn
    // and finishes before it.
    const nested = await startTurnRecorder({
      sessionId,
      turnKind: "find-superseded",
      model: "sonnet",
    });
    await new Promise((resolve) => setTimeout(resolve, 5));
    await nested.finish(TURN_SUCCEEDED);

    // The outer turn keeps running a while longer, then fails — the session's
    // `turnStatus` becomes `"failed"` because of *this* turn, even though the
    // nested one, by start time, looks more recent.
    await new Promise((resolve) => setTimeout(resolve, 5));
    await outer.finish("rate-limited");

    const retried = await resumeOrStartTurnRecorder({
      sessionId,
      turnKind: "propose-round",
      model: "sonnet",
      isManualRetry: true,
    });

    expect(retried.turnId).toBe(outer.turnId);
    const turn = await getTurnWithRuns(outer.turnId);
    expect(turn?.runs).toHaveLength(2);
    expect(turn?.runs[1]).toMatchObject({ runNumber: 2, manualRetry: true });

    // The nested turn is untouched: it succeeded and stays a turn of its own.
    const nestedTurn = await getTurnWithRuns(nested.turnId);
    expect(nestedTurn?.outcome).toBe(TURN_SUCCEEDED);
    expect(nestedTurn?.runs).toHaveLength(1);
  });

  it("a manual retry's new run reads the turn as running again until it finishes", async () => {
    const sessionId = await aSession();
    const { turnId, runId: firstRunId } = await createTurn({
      sessionId,
      turnKind: "propose-round",
      model: "fable",
    });
    const firstAttempt = await startAttempt(firstRunId);
    await completeAttempt({
      attemptId: firstAttempt.attemptId,
      kind: "rate-limit",
      reason: "The shared subscription's usage is exhausted for now.",
    });
    await completeTurn({ turnId, outcome: "rate-limited" });

    // Stopped: not the running turn, and its outcome is the failed run's.
    expect(await findRunningTurn(sessionId)).toBeNull();
    const stopped = await getTurnWithRuns(turnId);
    expect(stopped?.completedAt).not.toBeNull();
    expect(stopped?.outcome).toBe("rate-limited");

    const { runId: retryRunId } = await addRun(turnId);

    // Mid-retry: the turn reads as running again, with no stale outcome from
    // the run that just failed.
    const running = await findRunningTurn(sessionId);
    expect(running?.id).toBe(turnId);
    expect(running?.completedAt).toBeNull();
    expect(running?.outcome).toBeNull();

    const retryAttempt = await startAttempt(retryRunId);
    await completeAttempt({ attemptId: retryAttempt.attemptId, kind: "success" });
    await completeTurn({ turnId, outcome: "succeeded" });

    // Finished: completed again with the new outcome, no longer the running
    // turn, and its total elapsed time still spans both runs (measured from
    // the turn's original `startedAt`, not restarted for the retry).
    expect(await findRunningTurn(sessionId)).toBeNull();
    const finished = await getTurnWithRuns(turnId);
    expect(finished?.completedAt).not.toBeNull();
    expect(finished?.outcome).toBe("succeeded");
    expect(finished?.totalElapsedMs).not.toBeNull();
    expect(finished?.totalElapsedMs).toBeGreaterThanOrEqual(0);
    expect(finished?.runs).toHaveLength(2);
  });

  describe("findRunningTurn", () => {
    it("returns null for a session with no turn record", async () => {
      const sessionId = await aSession();
      expect(await findRunningTurn(sessionId)).toBeNull();
    });

    it("returns null once the session's only turn has completed", async () => {
      const sessionId = await aSession();
      const { turnId } = await createTurn({
        sessionId,
        turnKind: "assess-readiness",
        model: "fable",
      });
      await completeTurn({ turnId, outcome: "succeeded" });

      expect(await findRunningTurn(sessionId)).toBeNull();
    });

    it("finds the running turn of whichever kind is not yet complete", async () => {
      const sessionId = await aSession();
      const { turnId } = await createTurn({
        sessionId,
        turnKind: "review-stale",
        model: "sonnet",
      });

      const running = await findRunningTurn(sessionId);
      expect(running?.id).toBe(turnId);
      expect(running?.turnKind).toBe("review-stale");
      expect(running?.completedAt).toBeNull();
    });

    it("never returns a turn from a different, unrelated session", async () => {
      const sessionId = await aSession();
      const otherSessionId = await aSession();
      await createTurn({
        sessionId: otherSessionId,
        turnKind: "propose-round",
        model: "fable",
      });

      expect(await findRunningTurn(sessionId)).toBeNull();
    });

    it("prefers the most recently started turn still running, once a nested one has finished", async () => {
      const sessionId = await aSession();
      const outer = await createTurn({
        sessionId,
        turnKind: "propose-round",
        model: "sonnet",
      });
      await new Promise((resolve) => setTimeout(resolve, 5));
      const nested = await createTurn({
        sessionId,
        turnKind: "find-superseded",
        model: "sonnet",
      });

      // Both still running: the more recently started (nested) turn is the one
      // actually doing work right now.
      expect((await findRunningTurn(sessionId))?.id).toBe(nested.turnId);

      await completeTurn({ turnId: nested.turnId, outcome: "succeeded" });

      // Once the nested turn finishes, the outer one is again the only turn
      // still running.
      expect((await findRunningTurn(sessionId))?.id).toBe(outer.turnId);
    });
  });
});

describe("what each attempt stores of its usage", () => {
  useTestDatabase();

  const metrics: CliMetrics = {
    inputTokens: 10,
    outputTokens: 165,
    cacheReadTokens: 13856,
    cacheCreationTokens: 33442,
    costUsd: 0.0691046,
    cliTurns: 3,
    cliDurationMs: 4188,
    cliApiDurationMs: 3601,
    sessionId: "65f74ae9-6681-4ca7-89c9-efc3c8821877",
    toolCalls: { Glob: 2, Grep: 1, Read: 3 },
  };

  const noUsage = {
    inputTokens: null,
    outputTokens: null,
    cacheReadTokens: null,
    cacheCreationTokens: null,
    costUsd: null,
    cliTurns: null,
    cliDurationMs: null,
    cliApiDurationMs: null,
    sessionId: null,
    toolCalls: null,
  };

  /** Tell the recorder one model call ran and ended this way. */
  async function aCall(
    recorder: TurnRecorder,
    outcome: ModelCallOutcome,
    callMetrics?: CliMetrics,
  ) {
    const start = {
      requestKind: "propose-round" as const,
      call: 1,
      conversation: "new" as const,
      startedAt: new Date(),
    };
    await recorder.observer.callStarted?.(start);
    await recorder.observer.callEnded?.({
      ...start,
      endedAt: new Date(),
      durationMs: 1,
      outcome,
      ...(callMetrics ? { metrics: callMetrics } : {}),
    });
  }

  async function attemptsOf(recorder: TurnRecorder) {
    const turn = await getTurnWithRuns(recorder.turnId);
    return turn!.runs[0]!.attempts;
  }

  it("stores every usage field and the tool calls of a successful call", async () => {
    const recorder = await startTurnRecorder({
      sessionId: await aSession(),
      turnKind: "propose-round",
      model: "sonnet",
    });

    await aCall(recorder, { kind: "success", rawOutput: "{}" }, metrics);

    expect(await attemptsOf(recorder)).toEqual([
      expect.objectContaining({ kind: "success", ...metrics }),
    ]);
  });

  it("keeps the usage of a call whose result the app refused", async () => {
    const recorder = await startTurnRecorder({
      sessionId: await aSession(),
      turnKind: "propose-round",
      model: "sonnet",
    });

    await aCall(recorder, { kind: "success", rawOutput: "{}" }, metrics);
    await recorder.refused("Duplicate title.");

    expect(await attemptsOf(recorder)).toEqual([
      expect.objectContaining({
        kind: "tree-rule-refusal",
        reason: "Duplicate title.",
        ...metrics,
      }),
    ]);
  });

  it("stores the usage of a call whose result failed its schema", async () => {
    const recorder = await startTurnRecorder({
      sessionId: await aSession(),
      turnKind: "propose-round",
      model: "sonnet",
    });

    await aCall(
      recorder,
      { kind: "schema-invalid", rawOutput: "{}", reason: "Bad output." },
      { ...metrics, costUsd: null, toolCalls: {} },
    );

    expect(await attemptsOf(recorder)).toEqual([
      expect.objectContaining({
        kind: "schema-invalid",
        ...metrics,
        costUsd: null,
        toolCalls: {},
      }),
    ]);
  });

  it("stores every usage column as null for a call with no parseable result", async () => {
    const recorder = await startTurnRecorder({
      sessionId: await aSession(),
      turnKind: "propose-round",
      model: "sonnet",
    });

    await aCall(recorder, {
      kind: "error",
      code: "failed",
      reason: "The interviewer turn failed (exit code 1).",
    });

    expect(await attemptsOf(recorder)).toEqual([
      expect.objectContaining({ kind: "error", ...noUsage }),
    ]);
  });
});
