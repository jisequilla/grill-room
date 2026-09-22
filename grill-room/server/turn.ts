/**
 * One interviewer turn, from the session's point of view.
 *
 * Asking for the next round and reviewing what a reopened answer put in doubt
 * are different questions, but they are the same kind of event: the session
 * reads as working while the model thinks, a result the app cannot accept is
 * sent back with the app's reasons until a bound is spent, and whatever the
 * model is asked, it is shown the same tree. All three live here so neither
 * caller keeps its own copy.
 */
import { fail } from "@agent-native/core/action";
import { eq, inArray } from "@agent-native/core/db/schema";

import { getDb, schema } from "./db/index.js";
import type { DecisionAnswerKind } from "./db/schema.js";
import { isInterviewerError } from "./interviewer/index.js";
import type {
  AnswerKind,
  DecisionSnapshot,
  DecisionState,
} from "./interviewer/index.js";
import {
  deriveTreeStates,
  parseStringArray,
  treeFacts,
  type DecisionRow,
} from "./tree.js";

/**
 * How many times a result the app refuses is sent back with its reasons before
 * the user sees an error. Three attempts in total: one, then two retries.
 */
export const MAX_TURN_RETRIES = 2;

/**
 * A turn whose every attempt produced something the app would not store — a
 * proposal that breaks the tree's rules, a review that ruled on the wrong
 * decisions. Distinct from an interviewer fault: the model answered, the answer
 * was unusable.
 */
export class TurnRejected extends Error {
  constructor(
    /** Stored on the session and returned to the client as the error code. */
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

/** A session, as the turn bookkeeping needs it. */
type TurnSession = Pick<
  typeof schema.sessions.$inferSelect,
  "id" | "turnStatus"
>;

/**
 * Refuse to start a turn while one is already running. A turn costs a minute of
 * a shared subscription, and two of them on one session would race to write the
 * same tree.
 */
export function failIfTurnInProgress(
  session: TurnSession,
  message: string,
): void {
  if (session.turnStatus !== "working") return;
  fail(message, { errorCode: "turn-in-progress", statusCode: 409 });
}

/**
 * Run one turn against a session, keeping `turn_status` truthful throughout:
 * working while `take` runs, failed with the reason if it throws, idle with the
 * conversation to resume once it returns.
 *
 * `take` resolves with the conversation id; anything the turn writes to the
 * tree it writes itself, before returning, so a failed turn leaves the tree
 * exactly as it was.
 */
export async function runTurn(input: {
  sessionId: string;
  /** Stored when the failure is neither an interviewer fault nor a refusal. */
  failedMessage: string;
  take: () => Promise<string>;
}): Promise<void> {
  const db = getDb();
  const { sessionId } = input;

  const startedAt = new Date().toISOString();
  await db
    .update(schema.sessions)
    .set({
      turnStatus: "working",
      turnStartedAt: startedAt,
      turnErrorCode: null,
      turnErrorMessage: null,
      updatedAt: startedAt,
    })
    .where(eq(schema.sessions.id, sessionId));

  let conversationId: string;
  try {
    conversationId = await input.take();
  } catch (error) {
    const [code, message] = isInterviewerError(error)
      ? [error.code, error.message]
      : error instanceof TurnRejected
        ? [error.code, error.message]
        : ["failed", input.failedMessage];

    await db
      .update(schema.sessions)
      .set({
        turnStatus: "failed",
        turnErrorCode: code,
        turnErrorMessage: message,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(schema.sessions.id, sessionId));

    if (isInterviewerError(error) || error instanceof TurnRejected) {
      // Deliberately not a retryable status: a turn costs a minute of a shared
      // subscription, so retrying is the user's call, not the client's.
      fail(message, { errorCode: code, statusCode: 400 });
    }
    throw error;
  }

  await db
    .update(schema.sessions)
    .set({
      conversationId,
      turnStatus: "idle",
      turnErrorCode: null,
      turnErrorMessage: null,
      updatedAt: new Date().toISOString(),
    })
    .where(eq(schema.sessions.id, sessionId));
}

/**
 * Ask until the app can accept the answer, or the bound is spent.
 *
 * Each attempt carries forward the conversation the last one returned and the
 * reasons the app gave for refusing it, so the model is corrected in the same
 * thread rather than asked again blind. Nothing here writes: a caller stores
 * only what this resolves with.
 */
export async function askUntilAccepted<Result>(input: {
  /** The conversation to resume, or null to start one. */
  conversationId: string | null;
  ask: (attempt: {
    conversationId: string | null;
    /** Why the app refused the previous attempt, or null on the first. */
    rejectionReason: string | null;
  }) => Promise<{ result: Result; conversationId: string }>;
  /** Why this result cannot be stored, written for the interviewer. Empty when it can. */
  reasonsToRefuse: (result: Result) => string[];
  /** The failure to raise once every attempt has been refused. */
  exhausted: (lastReason: string) => TurnRejected;
}): Promise<{ result: Result; conversationId: string }> {
  let conversationId = input.conversationId;
  let rejectionReason = "";

  for (let attempt = 0; attempt <= MAX_TURN_RETRIES; attempt += 1) {
    const turn = await input.ask({
      conversationId,
      rejectionReason: attempt === 0 ? null : rejectionReason,
    });
    conversationId = turn.conversationId;

    const reasons = input.reasonsToRefuse(turn.result);
    if (reasons.length === 0) return turn;

    rejectionReason = reasons.join(" ");
  }

  throw input.exhausted(rejectionReason);
}

/** The port's answer vocabulary spells a disposition as its target. */
export function portAnswerKind(row: {
  answerKind: DecisionAnswerKind | null;
  dispositionTarget: DecisionRow["dispositionTarget"];
}): AnswerKind | null {
  if (!row.answerKind) return null;
  if (row.answerKind !== "dispositioned") return row.answerKind;
  return row.dispositionTarget ?? "out-of-scope";
}

/** The key the interviewer knows a decision by. */
export function portKey(row: Pick<DecisionRow, "id" | "key">): string {
  return row.key ?? row.id;
}

/**
 * The tree as the interviewer reads it, keys and all. A withdrawn decision has
 * left the tree and is left out entirely; a decision the user added is left out
 * too, until it is placed — it reaches the interviewer through
 * `userAddedDecisions` instead, since it has no dependencies to show yet.
 */
export async function decisionSnapshots(
  rows: readonly DecisionRow[],
): Promise<DecisionSnapshot[]> {
  const db = getDb();
  const keyById = new Map(
    rows.flatMap((row) => (row.key ? [[row.id, row.key] as const] : [])),
  );
  const states = deriveTreeStates(treeFacts(rows));

  const history = rows.length
    ? await db
        .select()
        .from(schema.decisionHistory)
        .where(
          inArray(
            schema.decisionHistory.decisionId,
            rows.map((row) => row.id),
          ),
        )
        .orderBy(schema.decisionHistory.recordedAt, schema.decisionHistory.id)
    : [];

  return rows
    .filter(
      (row) => row.withdrawnAt == null && row.awaitingPlacementSince == null,
    )
    .map((row) => {
      const kind = portAnswerKind(row);
      const rawState = states.get(row.id);
      const state: DecisionState =
        rawState === "settled" ||
        rawState === "frontier" ||
        rawState === "blocked" ||
        rawState === "stale"
          ? rawState
          : "blocked";
      return {
        key: portKey(row),
        title: row.questionTitle,
        body: row.questionBody,
        choices: parseStringArray(row.offeredChoicesJson),
        recommendedAnswer: row.recommendedAnswer ?? "",
        dependsOn: parseStringArray(row.dependsOnJson).flatMap((id) => {
          const key = keyById.get(id);
          return key ? [key] : [];
        }),
        state,
        answer: kind ? { kind, text: row.currentAnswer ?? "" } : null,
        previousAnswers: history
          .filter((entry) => entry.decisionId === row.id)
          .flatMap((entry) =>
            entry.answerKind
              ? [
                  {
                    kind: portAnswerKind({
                      answerKind: entry.answerKind,
                      dispositionTarget: null,
                    }) as AnswerKind,
                    text: entry.answer ?? "",
                  },
                ]
              : [],
          ),
        introducedBy: row.introducedBy,
      };
    });
}
