import { afterEach, describe, expect, it } from "vitest";

import { FAKE_CONVERSATION_ID } from "../server/interviewer/fake.js";
import {
  resetInterviewer,
  schemaInvalidTurn,
  scriptInterviewer,
} from "../server/interviewer/index.js";
import { aProposeRoundResult } from "../server/interviewer/test-fixtures.js";
import {
  addRun,
  completeAttempt,
  completeTurn,
  createTurn,
  findLatestTurn,
  startAttempt,
} from "../server/turn-records.js";
import { useTestDatabase } from "../test/db.js";
import createSession from "./create-session.js";
import getTurn from "./get-turn.js";
import requestNextRound from "./request-next-round.js";

async function aSession(): Promise<string> {
  const session = await createSession.run({
    title: "Grill Room",
    idea: "A local app that grills me about an idea until it is decided.",
  });
  return session.id;
}

describe("get-turn", () => {
  useTestDatabase();

  it("throws for a turn id that does not exist", async () => {
    await expect(getTurn.run({ turnId: "missing" })).rejects.toThrow(
      "Turn not found: missing",
    );
  });

  it("returns a turn with its runs and attempts in order, including raw output", async () => {
    const sessionId = await aSession();
    const { turnId, runId: firstRunId } = await createTurn({
      sessionId,
      turnKind: "propose-round",
      model: "opus",
    });

    const refusal = await startAttempt(firstRunId);
    await completeAttempt({
      attemptId: refusal.attemptId,
      kind: "tree-rule-refusal",
      reason: "Duplicate title.",
    });
    const failure = await startAttempt(firstRunId);
    await completeAttempt({
      attemptId: failure.attemptId,
      kind: "schema-invalid",
      reason: "Bad output.",
    });
    await completeTurn({ turnId, outcome: "schema-invalid" });

    const { runId: secondRunId } = await addRun(turnId);
    const success = await startAttempt(secondRunId);
    await completeAttempt({
      attemptId: success.attemptId,
      kind: "success",
      rawOutput: '{"round":{"cards":[]}}',
    });
    await completeTurn({ turnId, outcome: "succeeded" });

    const turn = await getTurn.run({ turnId });

    expect(turn).toMatchObject({
      id: turnId,
      sessionId,
      turnKind: "propose-round",
      model: "opus",
      outcome: "succeeded",
    });
    expect(turn.runs).toHaveLength(2);
    expect(turn.runs[0]).toMatchObject({ runNumber: 1, manualRetry: false });
    expect(turn.runs[0]?.attempts.map((a) => a.kind)).toEqual([
      "tree-rule-refusal",
      "schema-invalid",
    ]);
    expect(turn.runs[1]).toMatchObject({ runNumber: 2, manualRetry: true });
    expect(turn.runs[1]?.attempts).toEqual([
      expect.objectContaining({
        attemptNumber: 1,
        kind: "success",
        rawOutput: '{"round":{"cards":[]}}',
      }),
    ]);
  });

  describe("with the fake interviewer", () => {
    afterEach(resetInterviewer);

    it("exposes the fake's canned usage on every attempt that produced a result", async () => {
      const sessionId = await aSession();
      scriptInterviewer([
        schemaInvalidTurn("propose-round"),
        { kind: "propose-round", result: aProposeRoundResult() },
      ]);

      await expect(requestNextRound.run({ sessionId })).rejects.toThrow();
      await requestNextRound.run({ sessionId });

      const latest = await findLatestTurn({ sessionId, turnKind: "propose-round" });
      const turn = await getTurn.run({ turnId: latest!.id });
      const attempts = turn.runs.flatMap((run) => run.attempts);
      const canned = {
        inputTokens: 100,
        outputTokens: 20,
        cacheReadTokens: 0,
        cacheCreationTokens: 0,
        costUsd: 0,
        cliTurns: 1,
        cliDurationMs: 10,
        cliApiDurationMs: 10,
        sessionId: FAKE_CONVERSATION_ID,
        toolCalls: {},
      };
      expect(attempts).toEqual([
        expect.objectContaining({ kind: "schema-invalid", ...canned }),
        expect.objectContaining({ kind: "success", ...canned }),
      ]);
    });
  });
});
