/**
 * A batch of reopens with answers already decided.
 *
 * After comparing a grilled design against a system that already exists, the
 * user does not have one decision to change but a list of them, each with the
 * answer they now want. Applying that list one call at a time is what the
 * orchestrating session did over HTTP for the first real session
 * (`docs/design/session-retrospective.md`, finding 5); this is the same thing
 * as a feature.
 *
 * What that session found is the whole difficulty: **an item's own review can
 * answer a later item**. Reopening a foundation makes its dependents stale, the
 * review that follows re-asks the ones the new answer broke, and a decision
 * that was going to be reopened next is by then already open — `reopen-decision`
 * refuses it, correctly, as `decision-not-settled`. So each item is applied
 * against the tree *as it stands when the batch reaches it*, not as it stood
 * when the list was written:
 *
 * - settled or stale → reopen it, answer the card, submit the round;
 * - already open and a card of the open round → answer that card and submit;
 * - already open and a loose end → `answer-decision`;
 * - anything else (blocked, withdrawn, unplaced) → recorded and skipped.
 *
 * Nothing here duplicates turn bookkeeping: every path runs through the
 * existing actions, so one item is one or two ordinary interviewer turns and
 * `turn_status` stays exactly as truthful as it is outside a batch.
 */
import { eq } from "@agent-native/core/db/schema";

import { addDecisionCore } from "../actions/add-decision.js";
import answerDecision from "../actions/answer-decision.js";
import getCurrentRound from "../actions/get-current-round.js";
import { reopenDecisionCore } from "../actions/reopen-decision.js";
import saveDraftAnswer from "../actions/save-draft-answer.js";
import submitRound from "../actions/submit-round.js";
import { getDb, schema } from "./db/index.js";
import {
  deriveTreeStates,
  LOOSE_END_ANSWER_KINDS,
  treeFacts,
  type DecisionRow,
  type DerivedDecisionState,
} from "./tree.js";

/** What happened to one item of a batch. */
export type BatchItemStatus =
  /** It was settled or stale: reopened, answered, and its round submitted. */
  | "reopened"
  /** An earlier item's review had already re-asked it: answered as a card. */
  | "answered-as-card"
  /** It was an open loose end: answered outside a round. */
  | "answered-as-loose-end"
  /** Neither settled nor answerable right now. Nothing was written. */
  | "not-reopenable"
  /** The item failed, and the batch stopped here. */
  | "failed";

export interface BatchItemOutcome {
  decisionId: string;
  key: string | null;
  title: string;
  status: BatchItemStatus;
  /** The state the decision was in when the batch reached it. */
  state: DerivedDecisionState;
  /** What it failed with, on `failed` only. */
  error: { code: string; message: string } | null;
}

/**
 * A batch as it runs, stored on the session so a reload can show it. A batch
 * holds a turn for as long as its items take — one or two real interviewer
 * turns each — which is far longer than any request the client will wait on.
 */
export interface BatchProgress {
  total: number;
  completed: number;
  /** The item being applied right now, or null before the first and after the last. */
  current: { decisionId: string; title: string } | null;
  outcomes: BatchItemOutcome[];
}

export interface ReopenBatchResult extends BatchProgress {
  /** The decisions added once the items were applied. */
  added: { id: string; title: string }[];
  /** The 1-based item the batch stopped on, or null when every item was applied. */
  failedAt: number | null;
}

/** One item: a decision already resolved to an id, and the answer to give it. */
export interface ReopenBatchItem {
  decisionId: string;
  answer: string;
}

/** The progress stored on a session, or null when no batch is running. */
export function parseBatchProgress(json: string | null): BatchProgress | null {
  if (!json) return null;
  try {
    const parsed = JSON.parse(json) as Partial<BatchProgress>;
    if (typeof parsed.total !== "number") return null;
    return {
      total: parsed.total,
      completed: typeof parsed.completed === "number" ? parsed.completed : 0,
      current: parsed.current ?? null,
      outcomes: Array.isArray(parsed.outcomes) ? parsed.outcomes : [],
    };
  } catch {
    return null;
  }
}

/** The error code and message an action attached to a failure. */
function describeFailure(error: unknown): { code: string; message: string } {
  const message =
    error instanceof Error ? error.message : "The batch item failed.";
  const attached =
    error instanceof Error
      ? (error as unknown as { errorCode?: unknown }).errorCode
      : undefined;
  return {
    code: typeof attached === "string" ? attached : "failed",
    message,
  };
}

function isUnresolvedLooseEnd(row: DecisionRow): boolean {
  return (
    row.withdrawnAt == null &&
    row.answerKind != null &&
    (LOOSE_END_ANSWER_KINDS as readonly string[]).includes(row.answerKind)
  );
}

/**
 * Apply a list of reopens in order, and return an outcome for each.
 *
 * The caller has already refused a batch that cannot start — a turn working, a
 * batch already running, an item naming a decision that does not exist — so
 * everything from here is per-item.
 */
export async function applyReopenBatch(input: {
  sessionId: string;
  items: readonly ReopenBatchItem[];
  newDecisions: readonly { title: string; body: string }[];
}): Promise<ReopenBatchResult> {
  const db = getDb();
  const { sessionId, items } = input;

  const progress: BatchProgress = {
    total: items.length,
    completed: 0,
    current: null,
    outcomes: [],
  };

  await writeProgress(progress);

  let failedAt: number | null = null;
  const added: { id: string; title: string }[] = [];

  try {
    for (const [index, item] of items.entries()) {
      const rows = await loadDecisions();
      const row = rows.find((candidate) => candidate.id === item.decisionId);

      if (!row) {
        progress.outcomes.push({
          decisionId: item.decisionId,
          key: null,
          title: item.decisionId,
          status: "failed",
          state: "withdrawn",
          error: {
            code: "decision-not-found",
            message: `Decision not found: ${item.decisionId}`,
          },
        });
        progress.completed = progress.outcomes.length;
        progress.current = null;
        await writeProgress(progress);
        failedAt = index + 1;
        break;
      }

      const state =
        deriveTreeStates(treeFacts(rows)).get(row.id) ?? "blocked";

      progress.current = { decisionId: row.id, title: row.questionTitle };
      await writeProgress(progress);

      let outcome: BatchItemOutcome;
      try {
        outcome = await applyOne(row, state, item.answer);
      } catch (error) {
        outcome = {
          decisionId: row.id,
          key: row.key,
          title: row.questionTitle,
          status: "failed",
          state,
          error: describeFailure(error),
        };
      }

      progress.outcomes.push(outcome);
      progress.completed = progress.outcomes.length;
      progress.current = null;
      await writeProgress(progress);

      if (outcome.status === "failed") {
        failedAt = index + 1;
        break;
      }
    }

    // Only once every item landed. A batch that stopped halfway is one the user
    // will look at and probably run again, and decisions added by the run that
    // failed would arrive twice.
    if (failedAt === null) {
      for (const decision of input.newDecisions) {
        const row = await addDecisionCore({
          sessionId,
          title: decision.title,
          body: decision.body,
        });
        if (row) added.push({ id: row.id, title: row.questionTitle });
      }
    }
  } finally {
    await writeProgress(null);
  }

  return { ...progress, added, failedAt };

  function loadDecisions() {
    return db
      .select()
      .from(schema.decisions)
      .where(eq(schema.decisions.sessionId, sessionId))
      // `createdAt` has millisecond precision; id as a final tie-break keeps
      // this deterministic when two decisions land in the same millisecond.
      .orderBy(schema.decisions.createdAt, schema.decisions.id);
  }

  async function writeProgress(value: BatchProgress | null): Promise<void> {
    await db
      .update(schema.sessions)
      .set({
        batchProgressJson: value ? JSON.stringify(value) : null,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(schema.sessions.id, sessionId));
  }

  /** One item, against the tree as it stands now. */
  async function applyOne(
    row: DecisionRow,
    state: DerivedDecisionState,
    answer: string,
  ): Promise<BatchItemOutcome> {
    const outcome = (status: BatchItemStatus): BatchItemOutcome => ({
      decisionId: row.id,
      key: row.key,
      title: row.questionTitle,
      status,
      state,
      error: null,
    });

    if (state === "settled" || state === "stale") {
      const opened = await reopenDecisionCore(row.id);
      await answerAndSubmit(opened, row.id, answer);
      return outcome("reopened");
    }

    const open = await getCurrentRound.run({ sessionId });
    const isCard = (open.round?.decisions ?? []).some(
      (card) => card.id === row.id,
    );

    if (isCard) {
      await answerAndSubmit(open, row.id, answer);
      return outcome("answered-as-card");
    }

    if (isUnresolvedLooseEnd(row)) {
      await answerDecision.run({ decisionId: row.id, answer });
      return outcome("answered-as-loose-end");
    }

    return outcome("not-reopenable");
  }

  /**
   * Answer one card of the open round and submit it.
   *
   * Every other card that has no draft is deferred rather than left unanswered:
   * `submit-round` refuses an incomplete round, and a card the batch was not
   * asked about is not one it may answer. A deferral is the move that says
   * "later" without settling anything, and the interviewer asks it again.
   */
  async function answerAndSubmit(
    round: Awaited<ReturnType<typeof getCurrentRound.run>>,
    decisionId: string,
    answer: string,
  ): Promise<void> {
    const open = round.round;
    if (!open) {
      throw Object.assign(
        new Error(
          "The decision was answered but no round is open to submit, so the interviewer was never asked to review it.",
        ),
        { errorCode: "no-open-round" },
      );
    }

    await saveDraftAnswer.run({
      decisionId,
      answerKind: "own-answer",
      answer,
    });

    for (const card of open.decisions) {
      if (card.id === decisionId || card.draft) continue;
      await saveDraftAnswer.run({
        decisionId: card.id,
        answerKind: "deferred",
      });
    }

    await submitRound.run({ id: open.id });
  }
}
