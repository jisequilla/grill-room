/**
 * What a running turn writes its history through.
 *
 * A recorder is created when a turn starts, with the turn record and its first
 * run — or, for a manual retry of a turn kind whose latest record stopped
 * without succeeding, with a new run added to that same record instead. It
 * hands the interviewer an observer that turns every model call into an
 * attempt as it happens — added when the call starts, completed when it
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
  addRun,
  completeAttempt,
  completeTurn,
  createTurn,
  findLatestCompletedTurn,
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
  /**
   * The app kept the result the last successful call produced, but not all of
   * it: that attempt stays a success, carrying `note` as its reason.
   */
  noted(note: string): Promise<void>;
}

export interface TurnRecorder extends AttemptRecorder {
  readonly turnId: string;
  /** Close the turn record with `"succeeded"` or the failure code it stopped with. */
  finish(outcome: string): Promise<void>;
}

/** How one model call's outcome is stored as an attempt. */
function attemptOf(outcome: ModelCallOutcome): {
  kind: AttemptKind;
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
      return {
        kind: "error",
        reason: `${outcome.code}: ${outcome.reason}`,
        rawOutput: null,
      };
  }
}

/**
 * Wire a recorder around one run: the observer that turns model calls into
 * attempts, the relabelling a refusal needs, and the close that writes the
 * turn's outcome. Shared by a turn's first run and a manual retry's run alike
 * — a recorder behaves the same whichever run it is writing to.
 */
function recorderFor(turnId: string, runId: string): TurnRecorder {
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
    async noted(note) {
      const attemptId = lastSucceeded;
      if (!attemptId) return;
      await relabelAttempt({ attemptId, kind: "success", reason: note });
    },
    async finish(outcome) {
      await completeTurn({ turnId, outcome });
    },
  };
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
  return recorderFor(turnId, runId);
}

/**
 * Start a turn record, or — when `isManualRetry` is set and the session's
 * most recently *completed* turn record of any kind is of this `turnKind`
 * and stopped without succeeding — add a new run to that same record instead
 * of starting a fresh one. This is what makes a manual retry continue the
 * turn it is retrying for every turn kind, without the caller doing anything
 * differently: it still only names the kind and the model, exactly as
 * {@link startTurnRecorder}.
 *
 * The check is deliberately not scoped to `turnKind` alone, and deliberately
 * ordered by completion rather than start: a manual retry only ever
 * continues the turn that actually left the session's turn status
 * `"failed"`, which is always the session's most recently *completed* turn
 * of any kind at that moment (see {@link findLatestCompletedTurn}). Scoping
 * by kind alone, or ordering by start time, would wrongly join a call to an
 * older, unrelated stopped turn of the same kind — for example a stale
 * review that stopped and was never retried, followed later by a failed
 * round proposal, followed by a fresh stale review: that fresh review must
 * start its own turn, not revive the old one and inherit its hours-old
 * elapsed time. Ordering by start time alone has the same failure for a turn
 * nested inside another, such as the supersession scan a done proposal runs
 * inside its `propose-round` turn: the nested turn starts later but finishes
 * first, so it is never the turn whose later failure left the session
 * `"failed"`.
 *
 * Once a turn of `turnKind` has succeeded, its record is not a candidate to
 * continue: the next call — manual retry or not — starts a new turn.
 */
export async function resumeOrStartTurnRecorder(input: {
  sessionId: string;
  turnKind: string;
  model: string;
  /**
   * Whether the session's turn was left `"failed"` before this turn began —
   * the only situation a manual retry can be, since there is no separate
   * retry action; calling in again while idle or working is not a retry.
   */
  isManualRetry: boolean;
}): Promise<TurnRecorder> {
  if (input.isManualRetry) {
    const latest = await findLatestCompletedTurn(input.sessionId);
    if (
      latest &&
      latest.turnKind === input.turnKind &&
      latest.outcome != null &&
      latest.outcome !== TURN_SUCCEEDED
    ) {
      const { runId } = await addRun(latest.id);
      return recorderFor(latest.id, runId);
    }
  }

  return startTurnRecorder({
    sessionId: input.sessionId,
    turnKind: input.turnKind,
    model: input.model,
  });
}
