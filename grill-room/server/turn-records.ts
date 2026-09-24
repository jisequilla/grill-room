/**
 * Turn visibility: a per-turn record of every run and attempt a model turn
 * made, kept beside the session's turn lock rather than replacing it.
 *
 * `server/turn.ts` owns the turn lock (`turnStatus`/`turnErrorCode`/…) and the
 * retry loop (`askUntilAccepted`). This module is the history the loop writes
 * to as it goes: a turn record holds its runs in order, each run holds its
 * attempts in order, and every field is written as it happens rather than
 * batched at the end, so a running turn's progress survives navigation and
 * reload.
 *
 * This module only creates, appends to and reads back turn records; nothing
 * here changes retry behaviour. `server/turn-recorder.ts` is what a running
 * turn writes through.
 */
import { randomUUID } from "node:crypto";

import { and, desc, eq, inArray, isNull } from "@agent-native/core/db/schema";

import { getDb, schema } from "./db/index.js";
import type { AttemptKind } from "./db/schema.js";

/** A turn record's first run, created together with the turn. */
export interface CreatedTurn {
  turnId: string;
  runId: string;
}

/**
 * Create a turn record and its first run.
 *
 * `turnKind` is free text: the six request kinds `askUntilAccepted` runs
 * today, and any later kind, are stored and read back the same way — no
 * migration needed for a new one. `model` is the interviewer model the turn
 * runs on.
 */
export async function createTurn(input: {
  sessionId: string;
  turnKind: string;
  model: string;
}): Promise<CreatedTurn> {
  const db = getDb();
  const now = new Date().toISOString();
  const turnId = randomUUID();
  const runId = randomUUID();

  await db.insert(schema.turns).values({
    id: turnId,
    sessionId: input.sessionId,
    turnKind: input.turnKind,
    model: input.model,
    startedAt: now,
  });

  await db.insert(schema.turnRuns).values({
    id: runId,
    turnId,
    runNumber: 1,
    manualRetry: false,
    createdAt: now,
  });

  return { turnId, runId };
}

/**
 * Start a new run on an existing turn record: what a manual retry adds. Every
 * run added this way is a manual retry by construction — the first run only
 * ever comes from {@link createTurn} — and the run number picks up after the
 * highest one the turn already has, so the attempt/budget counter for the new
 * run starts again at 1.
 */
export async function addRun(
  turnId: string,
): Promise<{ runId: string; runNumber: number }> {
  const db = getDb();
  const existingRuns = await db
    .select()
    .from(schema.turnRuns)
    .where(eq(schema.turnRuns.turnId, turnId));

  const runNumber =
    existingRuns.reduce((max, run) => Math.max(max, run.runNumber), 0) + 1;
  const runId = randomUUID();

  await db.insert(schema.turnRuns).values({
    id: runId,
    turnId,
    runNumber,
    manualRetry: true,
    createdAt: new Date().toISOString(),
  });

  return { runId, runNumber };
}

/**
 * Add an attempt to a run when a model call starts, numbered after however
 * many the run already has. Its kind, reason and raw output are unset until
 * {@link completeAttempt} runs, so a still-running attempt reads back with
 * those fields null and no duration.
 */
export async function startAttempt(
  runId: string,
): Promise<{ attemptId: string; attemptNumber: number }> {
  const db = getDb();
  const existingAttempts = await db
    .select()
    .from(schema.turnAttempts)
    .where(eq(schema.turnAttempts.runId, runId));

  const attemptNumber =
    existingAttempts.reduce(
      (max, attempt) => Math.max(max, attempt.attemptNumber),
      0,
    ) + 1;
  const attemptId = randomUUID();

  await db.insert(schema.turnAttempts).values({
    id: attemptId,
    runId,
    attemptNumber,
    startedAt: new Date().toISOString(),
  });

  return { attemptId, attemptNumber };
}

/**
 * Complete an attempt when its model call returns or fails: its kind, the
 * one-line reason for anything that is not a success, the raw output where
 * there is one, and its duration since it started. Does nothing if the
 * attempt id is not found, so a caller racing a database reset never throws
 * on cleanup.
 */
export async function completeAttempt(input: {
  attemptId: string;
  kind: AttemptKind;
  reason?: string | null;
  rawOutput?: string | null;
}): Promise<void> {
  const db = getDb();
  const [attempt] = await db
    .select()
    .from(schema.turnAttempts)
    .where(eq(schema.turnAttempts.id, input.attemptId))
    .limit(1);
  if (!attempt) return;

  const now = new Date().toISOString();
  const durationMs =
    new Date(now).getTime() - new Date(attempt.startedAt).getTime();

  await db
    .update(schema.turnAttempts)
    .set({
      kind: input.kind,
      reason: input.reason ?? null,
      rawOutput: input.rawOutput ?? null,
      durationMs,
    })
    .where(eq(schema.turnAttempts.id, input.attemptId));
}

/**
 * Change a completed attempt's kind and reason, keeping its duration and raw
 * output. What a call the port reported as a success becomes once the app
 * refuses the result it produced.
 */
export async function relabelAttempt(input: {
  attemptId: string;
  kind: AttemptKind;
  reason: string | null;
}): Promise<void> {
  await getDb()
    .update(schema.turnAttempts)
    .set({ kind: input.kind, reason: input.reason })
    .where(eq(schema.turnAttempts.id, input.attemptId));
}

/**
 * The most recently started turn record of one kind for a session, or null
 * when the session has none: how a caller finds the turn a stopped action
 * left behind, which has no round or result to point at it.
 */
export async function findLatestTurn(input: {
  sessionId: string;
  turnKind: string;
}): Promise<TurnView | null> {
  const [latest] = await getDb()
    .select({ id: schema.turns.id })
    .from(schema.turns)
    .where(
      and(
        eq(schema.turns.sessionId, input.sessionId),
        eq(schema.turns.turnKind, input.turnKind),
      ),
    )
    .orderBy(desc(schema.turns.startedAt), desc(schema.turns.id))
    .limit(1);
  return latest ? getTurnWithRuns(latest.id) : null;
}

/**
 * The turn currently running for a session, of any kind, or null when none is
 * running. Only one turn ever runs on a session at a time — the turn lock —
 * so this is unambiguous. This is how the live turn status finds the record
 * for whichever kind actually started it (a round proposal, a readiness
 * judgment, a stale review, or a supersession check) instead of assuming one
 * kind.
 */
export async function findRunningTurn(
  sessionId: string,
): Promise<TurnView | null> {
  const [running] = await getDb()
    .select({ id: schema.turns.id })
    .from(schema.turns)
    .where(
      and(eq(schema.turns.sessionId, sessionId), isNull(schema.turns.completedAt)),
    )
    .orderBy(desc(schema.turns.startedAt), desc(schema.turns.id))
    .limit(1);
  return running ? getTurnWithRuns(running.id) : null;
}

/**
 * The most recently *completed* turn record of any kind for a session, or
 * null when the session has none finished yet. Unlike {@link findLatestTurn},
 * not scoped to one kind, and ordered by completion time rather than start
 * time: a turn nested inside another — the supersession scan a done proposal
 * runs inside its `propose-round` turn, say — starts after and finishes
 * before the turn around it, so ordering by start time would call the nested
 * turn "latest" while the outer turn, still running, is the one that goes on
 * to leave the session's `turnStatus` `"failed"`. Only the turn that actually
 * left the session failed is ever the latest *completed* turn of any kind at
 * that moment — this is what a manual retry must find, so it never joins an
 * older, unrelated stopped turn that only happens to share its kind.
 *
 * Read in application code rather than left to the database's ordering of
 * nulls (running turns have no `completedAt` yet), which differs by engine.
 */
export async function findLatestCompletedTurn(
  sessionId: string,
): Promise<TurnView | null> {
  const rows = await getDb()
    .select({ id: schema.turns.id, completedAt: schema.turns.completedAt })
    .from(schema.turns)
    .where(eq(schema.turns.sessionId, sessionId));

  let latest: { id: string; completedAt: string } | null = null;
  for (const row of rows) {
    if (row.completedAt == null) continue;
    if (
      !latest ||
      row.completedAt > latest.completedAt ||
      (row.completedAt === latest.completedAt && row.id > latest.id)
    ) {
      latest = { id: row.id, completedAt: row.completedAt };
    }
  }

  return latest ? getTurnWithRuns(latest.id) : null;
}

/**
 * Complete a turn record once it stops, successfully or not: its outcome —
 * `"succeeded"`, or the failure code the turn stopped with — and its total
 * elapsed time since it started, spanning every run. Does nothing if the turn
 * id is not found.
 */
export async function completeTurn(input: {
  turnId: string;
  outcome: string;
}): Promise<void> {
  const db = getDb();
  const [turn] = await db
    .select()
    .from(schema.turns)
    .where(eq(schema.turns.id, input.turnId))
    .limit(1);
  if (!turn) return;

  const now = new Date().toISOString();
  const totalElapsedMs =
    new Date(now).getTime() - new Date(turn.startedAt).getTime();

  await db
    .update(schema.turns)
    .set({ completedAt: now, totalElapsedMs, outcome: input.outcome })
    .where(eq(schema.turns.id, input.turnId));
}

/** One attempt, as {@link getTurnWithRuns} returns it. */
export interface TurnAttemptView {
  id: string;
  attemptNumber: number;
  startedAt: string;
  durationMs: number | null;
  kind: AttemptKind | null;
  reason: string | null;
  rawOutput: string | null;
}

/** One run and its attempts in order, as {@link getTurnWithRuns} returns it. */
export interface TurnRunView {
  id: string;
  runNumber: number;
  manualRetry: boolean;
  createdAt: string;
  attempts: TurnAttemptView[];
}

/** A whole turn record, as {@link getTurnWithRuns} returns it. */
export interface TurnView {
  id: string;
  sessionId: string;
  turnKind: string;
  model: string;
  startedAt: string;
  completedAt: string | null;
  totalElapsedMs: number | null;
  outcome: string | null;
  runs: TurnRunView[];
}

/**
 * Read a turn back with its runs and attempts in order: runs by
 * `runNumber`, attempts within each run by `attemptNumber`. Null when no turn
 * has this id — the caller's case for a round, spec or readiness judgment
 * from before turn records existed, which has no linked turn.
 */
export async function getTurnWithRuns(
  turnId: string,
): Promise<TurnView | null> {
  const db = getDb();

  const [turn] = await db
    .select()
    .from(schema.turns)
    .where(eq(schema.turns.id, turnId))
    .limit(1);
  if (!turn) return null;

  const runs = await db
    .select()
    .from(schema.turnRuns)
    .where(eq(schema.turnRuns.turnId, turnId))
    .orderBy(schema.turnRuns.runNumber);

  const attempts = runs.length
    ? await db
        .select()
        .from(schema.turnAttempts)
        .where(
          inArray(
            schema.turnAttempts.runId,
            runs.map((run) => run.id),
          ),
        )
        .orderBy(schema.turnAttempts.attemptNumber)
    : [];

  return {
    id: turn.id,
    sessionId: turn.sessionId,
    turnKind: turn.turnKind,
    model: turn.model,
    startedAt: turn.startedAt,
    completedAt: turn.completedAt,
    totalElapsedMs: turn.totalElapsedMs,
    outcome: turn.outcome,
    runs: runs.map((run) => ({
      id: run.id,
      runNumber: run.runNumber,
      manualRetry: run.manualRetry,
      createdAt: run.createdAt,
      attempts: attempts
        .filter((attempt) => attempt.runId === run.id)
        .map((attempt) => ({
          id: attempt.id,
          attemptNumber: attempt.attemptNumber,
          startedAt: attempt.startedAt,
          durationMs: attempt.durationMs,
          kind: attempt.kind,
          reason: attempt.reason,
          rawOutput: attempt.rawOutput,
        })),
    })),
  };
}
