/**
 * What a running turn writes its history through.
 *
 * A recorder is created when a turn starts, with the turn record and its first
 * run. It hands the interviewer an observer that turns every model call into
 * an attempt as it happens — added when the call starts, completed when it
 * returns or fails — and lets the retry loop relabel the call whose result the
 * app refused. `runTurn` closes it with the turn's outcome. Every turn kind
 * records the same way: name the kind and the model, pass the recorder's
 * `observer` to the port and the recorder itself to `askUntilAccepted`.
 */
import type {
  ModelCallEnd,
  ModelCallObserver,
  ModelCallOutcome,
} from "./interviewer/index.js";
import type { AttemptKind } from "./db/schema.js";
import {
  completeAttempt,
  completeTurn,
  createTurn,
  relabelAttempt,
  startAttempt,
} from "./turn-records.js";

/** The outcome a turn record stores when the turn's result was accepted. */
export const TURN_SUCCEEDED = "succeeded";

/** What the retry loop needs from a recorder. */
export interface AttemptRecorder {
  /** Pass to the interviewer method, so each model call it makes is recorded. */
  readonly observer: ModelCallObserver;
  /**
   * The app refused the result the last successful call produced: that
   * attempt becomes a tree-rule refusal, with the reason sent back to the
   * interviewer.
   */
  refused(reason: string): Promise<void>;
}

export interface TurnRecorder extends AttemptRecorder {
  readonly turnId: string;
  /** Close the turn record with `"succeeded"` or the failure code it stopped with. */
  finish(outcome: string): Promise<void>;
}

/** How one model call's outcome is stored as an attempt. */
function attemptOf(outcome: ModelCallOutcome): {
  kind: AttemptKind | null;
  reason: string | null;
  rawOutput: string | null;
} {
  switch (outcome.kind) {
    case "success":
      return { kind: "success", reason: null, rawOutput: outcome.rawOutput };
    case "schema-invalid":
      return {
        kind: "schema-invalid",
        reason: outcome.reason,
        rawOutput: outcome.rawOutput,
      };
    case "rate-limited":
      return { kind: "rate-limit", reason: outcome.reason, rawOutput: null };
    case "resume-fallback":
      return {
        kind: "resume-fallback",
        reason: outcome.reason,
        rawOutput: null,
      };
    case "error":
      // No attempt kind names an interviewer fault; the reason says what it
      // was and the turn's outcome carries its code.
      return {
        kind: null,
        reason: `${outcome.code}: ${outcome.reason}`,
        rawOutput: null,
      };
  }
}

/**
 * Create a turn record, with its first run, for a turn of `turnKind` running
 * on `model` (the session's interviewer model), and return the recorder that
 * writes its attempts.
 */
export async function startTurnRecorder(input: {
  sessionId: string;
  turnKind: string;
  model: string;
}): Promise<TurnRecorder> {
  const { turnId, runId } = await createTurn(input);

  let running: string | null = null;
  let lastSucceeded: string | null = null;

  const observer: ModelCallObserver = {
    async callStarted() {
      const { attemptId } = await startAttempt(runId);
      running = attemptId;
      lastSucceeded = null;
    },
    async callEnded(call: ModelCallEnd) {
      const attemptId = running;
      running = null;
      if (!attemptId) return;
      await completeAttempt({ attemptId, ...attemptOf(call.outcome) });
      if (call.outcome.kind === "success") lastSucceeded = attemptId;
    },
  };

  return {
    turnId,
    observer,
    async refused(reason) {
      const attemptId = lastSucceeded;
      lastSucceeded = null;
      if (!attemptId) return;
      await relabelAttempt({ attemptId, kind: "tree-rule-refusal", reason });
    },
    async finish(outcome) {
      await completeTurn({ turnId, outcome });
    },
  };
}
