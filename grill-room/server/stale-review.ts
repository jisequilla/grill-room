/**
 * The stale review turn: what the interviewer is asked once a reopened decision
 * has an answer again.
 *
 * Reopening a decision stamps `reopenedAt` on it and clears its answer, which
 * is all derivation needs to mark every transitive dependent **stale**. Those
 * dependents are not re-asked: when the reopened decision settles again, the
 * interviewer rules on each one, either reconfirming it — it keeps its answer
 * and settles again — or re-asking it with an updated question, which returns
 * it to the tree unanswered and lets the ordinary frontier rule pick it up.
 *
 * Everything the review needs lives here rather than in the actions, so the
 * seam with `submit-round` is a single call.
 */
import { randomUUID } from "node:crypto";

import { fail } from "@agent-native/core/action";
import { eq, inArray } from "@agent-native/core/db/schema";

import { getDb, schema } from "./db/index.js";
import type { DecisionAnswerKind } from "./db/schema.js";
import { getInterviewer, isInterviewerError } from "./interviewer/index.js";
import type {
  AnswerKind,
  DecisionSnapshot,
  ReviewStaleResult,
} from "./interviewer/index.js";
import {
  deriveTreeStates,
  parseStringArray,
  type DecisionRow,
  type TreeDecision,
} from "./tree.js";

/**
 * How many times a review that does not rule on exactly the decisions it was
 * given is sent back with the reason. The same bound `request-next-round` uses
 * for a rejected proposal: three attempts in total.
 */
const MAX_REVIEW_RETRIES = 2;

/** A review that never ruled on the right decisions. Distinct from an interviewer fault. */
class ReviewRejected extends Error {}

/** One review turn's worth of work: a reopened decision and what it put in doubt. */
export interface DueStaleReview {
  /** The decision that was reopened and has since been answered again. */
  reopenedId: string;
  /** The stale decisions hanging off it, in the order they were given. */
  staleIds: string[];
}

/**
 * Where a verdict's reason is kept. `gr_decision_history` has no column for it,
 * and this ticket adds no migration, so it is appended to the history row's
 * copy of the question body — a field nothing reads back. Move it to a column
 * of its own the next time the schema moves.
 */
export const REVIEW_REASON_MARKER = "\n\n---\nStale review";

/** Every transitive dependency of `id`. Cycle-safe, and tolerates dangling ids. */
function transitiveDependencyIds(
  id: string,
  byId: ReadonlyMap<string, TreeDecision>,
): string[] {
  const seen = new Set<string>();
  const queue = [...(byId.get(id)?.dependsOn ?? [])];

  while (queue.length > 0) {
    const next = queue.shift();
    if (next === undefined || seen.has(next)) continue;
    seen.add(next);
    const node = byId.get(next);
    if (node) queue.push(...node.dependsOn);
  }

  return [...seen];
}

/** The facts derivation and selection work from. */
export function treeFacts(rows: readonly DecisionRow[]): TreeDecision[] {
  return rows.map((row) => ({
    id: row.id,
    dependsOn: parseStringArray(row.dependsOnJson),
    answerKind: row.answerKind,
    settledAt: row.settledAt,
    reopenedAt: row.reopenedAt,
  }));
}

/**
 * The reviews that are due right now, one per reopened decision.
 *
 * A stale decision is due when the reopened decision that put it in doubt has
 * settled again: until the user has answered it, there is nothing for the
 * interviewer to judge the dependents against. A decision that two reopens
 * disturbed is reviewed under the more recent of them, so every stale decision
 * belongs to exactly one request and one verdict answers it.
 */
export function dueStaleReviews(
  decisions: readonly TreeDecision[],
): DueStaleReview[] {
  const byId = new Map(decisions.map((decision) => [decision.id, decision]));
  const states = deriveTreeStates(decisions);
  const groups = new Map<string, string[]>();

  for (const decision of decisions) {
    if (states.get(decision.id) !== "stale") continue;

    const since = decision.settledAt ?? "";
    let chosen: TreeDecision | undefined;

    for (const ancestorId of transitiveDependencyIds(decision.id, byId)) {
      const ancestor = byId.get(ancestorId);
      const reopenedAt = ancestor?.reopenedAt;
      if (!ancestor || reopenedAt == null || reopenedAt <= since) continue;
      if (states.get(ancestorId) !== "settled") continue;

      const best = chosen?.reopenedAt ?? "";
      if (
        !chosen ||
        reopenedAt > best ||
        (reopenedAt === best && ancestorId < chosen.id)
      ) {
        chosen = ancestor;
      }
    }

    if (!chosen) continue;
    groups.set(chosen.id, [...(groups.get(chosen.id) ?? []), decision.id]);
  }

  return [...groups].map(([reopenedId, staleIds]) => ({
    reopenedId,
    staleIds,
  }));
}

/**
 * Why a review result cannot be applied, written for the interviewer: it is
 * sent back verbatim. Empty when the result rules on exactly the decisions the
 * request listed, once each.
 */
export function reviewRejectionReasons(
  expectedKeys: readonly string[],
  result: ReviewStaleResult,
): string[] {
  const reasons: string[] = [];
  const expected = new Set(expectedKeys);
  const seen = new Set<string>();
  const duplicated = new Set<string>();

  for (const review of result.reviews) {
    if (seen.has(review.decisionKey)) duplicated.add(review.decisionKey);
    seen.add(review.decisionKey);
  }

  for (const key of duplicated) {
    reasons.push(`Decision "${key}" was ruled on twice in the same review.`);
  }

  for (const key of expectedKeys) {
    if (!seen.has(key)) {
      reasons.push(
        `Decision "${key}" is stale and was not ruled on. Every decision listed needs a reconfirm or a re-ask.`,
      );
    }
  }

  for (const key of seen) {
    if (!expected.has(key)) {
      reasons.push(
        `Decision "${key}" was ruled on but is not one of the stale decisions in this review. Rule only on the ones listed.`,
      );
    }
  }

  return reasons;
}

/** The port's answer vocabulary spells a disposition as its target. */
function portAnswerKind(row: {
  answerKind: DecisionAnswerKind | null;
  dispositionTarget: DecisionRow["dispositionTarget"];
}): AnswerKind | null {
  if (!row.answerKind) return null;
  if (row.answerKind !== "dispositioned") return row.answerKind;
  return row.dispositionTarget ?? "out-of-scope";
}

/** The key the interviewer knows a decision by. */
function portKey(row: DecisionRow): string {
  return row.key ?? row.id;
}

/**
 * Put back the reopen stamps that settling a round cleared.
 *
 * `submit-round` blanks `reopenedAt` on every card it settles, which for a
 * reopened decision is the very fact its dependents' staleness is derived
 * from. The reopen is recoverable because reopening also writes a history row,
 * and its timestamp is the moment of the reopen. Delete this once settling
 * stops clearing the stamp.
 */
async function restoreReopenMarks(submittedRoundId: string): Promise<void> {
  const db = getDb();

  const placements = await db
    .select()
    .from(schema.roundDecisions)
    .where(eq(schema.roundDecisions.roundId, submittedRoundId));

  if (placements.length === 0) return;

  const ids = placements.map((placement) => placement.decisionId);

  const settled = await db
    .select()
    .from(schema.decisions)
    .where(inArray(schema.decisions.id, ids));

  const history = await db
    .select()
    .from(schema.decisionHistory)
    .where(inArray(schema.decisionHistory.decisionId, ids));

  for (const row of settled) {
    if (row.reopenedAt != null || row.settledAt == null) continue;

    const disturbed = history
      .filter((entry) => entry.decisionId === row.id)
      .map((entry) => entry.recordedAt)
      .sort();
    const lastDisturbed = disturbed[disturbed.length - 1];

    if (lastDisturbed == null) continue;

    await db
      .update(schema.decisions)
      .set({ reopenedAt: lastDisturbed })
      .where(eq(schema.decisions.id, row.id));
  }
}

/**
 * Run every stale review the session is due, and apply the verdicts.
 *
 * Called by `submit-round` once the round's answers are settled and before the
 * next round is requested, so a reopened decision's dependents are judged
 * before the interview moves on. Does nothing at all — not even a turn status
 * — when nothing is stale, which is every ordinary round.
 */
export async function runDueStaleReviews(input: {
  sessionId: string;
  submittedRoundId: string;
}): Promise<void> {
  const db = getDb();
  const { sessionId } = input;

  await restoreReopenMarks(input.submittedRoundId);

  const loadDecisions = () =>
    db
      .select()
      .from(schema.decisions)
      .where(eq(schema.decisions.sessionId, sessionId))
      .orderBy(schema.decisions.createdAt);

  let rows = await loadDecisions();
  let due = dueStaleReviews(treeFacts(rows));
  if (due.length === 0) return;

  const [session] = await db
    .select()
    .from(schema.sessions)
    .where(eq(schema.sessions.id, sessionId))
    .limit(1);

  if (!session) return;

  // The same bookkeeping `request-next-round` does around a turn, written out
  // again rather than shared: both files are being changed by other work, and
  // one place to unify them is easier to find than a half-made seam.
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

  let conversationId = session.conversationId;

  try {
    // Each turn takes its group out of the stale set, so the list shrinks; the
    // bound only stops a pathological tree from looping.
    for (let guard = rows.length + 1; due.length > 0 && guard > 0; guard -= 1) {
      const turn = await reviewOne(due[0] as DueStaleReview, conversationId);
      conversationId = turn.conversationId;
      await applyReviews(turn.result);
      rows = await loadDecisions();
      due = dueStaleReviews(treeFacts(rows));
    }
  } catch (error) {
    const [code, message] = isInterviewerError(error)
      ? [error.code, error.message]
      : error instanceof ReviewRejected
        ? ["invalid-review", error.message]
        : ["failed", "The stale review turn failed."];

    await db
      .update(schema.sessions)
      .set({
        turnStatus: "failed",
        turnErrorCode: code,
        turnErrorMessage: message,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(schema.sessions.id, sessionId));

    if (isInterviewerError(error) || error instanceof ReviewRejected) {
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

  /**
   * One review turn, retried with the app's reasons while the interviewer rules
   * on the wrong set of decisions. Nothing is written until a result is
   * accepted whole, so a rejected one leaves the tree exactly as it was.
   */
  async function reviewOne(
    group: DueStaleReview,
    resumeFrom: string | null,
  ): Promise<{ result: ReviewStaleResult; conversationId: string }> {
    const interviewer = getInterviewer();
    let conversation = resumeFrom;
    let rejectionReason: string | null = null;

    for (let attempt = 0; attempt <= MAX_REVIEW_RETRIES; attempt += 1) {
      const current = await loadDecisions();
      const byId = new Map(current.map((row) => [row.id, row]));
      const keyOf = (id: string) => {
        const row = byId.get(id);
        return row ? portKey(row) : id;
      };
      const staleKeys = group.staleIds.map(keyOf);

      const turn = await interviewer.reviewStale({
        kind: "review-stale",
        context: {
          idea: session!.idea,
          title: session!.title,
          model: session!.model,
          answeringMode: session!.answeringMode,
          conversationId: conversation,
          decisions: await snapshots(current),
        },
        reopenedDecisionKey: keyOf(group.reopenedId),
        staleDecisionKeys: staleKeys,
        rejectionReason,
      });

      conversation = turn.conversationId;

      const reasons = reviewRejectionReasons(staleKeys, turn.result);
      if (reasons.length === 0) {
        return { result: turn.result, conversationId: turn.conversationId };
      }

      rejectionReason = reasons.join(" ");
    }

    throw new ReviewRejected(
      `The interviewer reviewed the stale decisions wrongly ${MAX_REVIEW_RETRIES + 1} times. Last reason: ${rejectionReason}`,
    );
  }

  /**
   * Apply a whole review. A reconfirmed decision settles again with the answer
   * it already had; a re-asked one keeps that answer only as history and
   * rejoins the tree unanswered, carrying the interviewer's updated question.
   */
  async function applyReviews(result: ReviewStaleResult): Promise<void> {
    const current = await loadDecisions();
    const byKey = new Map(current.map((row) => [portKey(row), row]));
    // One stamp for the whole review, and never earlier than the reopen it
    // answers: a reconfirmed decision that read as older than the reopen would
    // still derive as stale, and the review would be due all over again. Two
    // decisions re-asked and reconfirmed together share the stamp, so neither
    // makes the other stale.
    const now = current.reduce(
      (latest, row) =>
        row.reopenedAt != null && row.reopenedAt > latest
          ? row.reopenedAt
          : latest,
      new Date().toISOString(),
    );

    for (const review of result.reviews) {
      const row = byKey.get(review.decisionKey);
      if (!row) continue;

      await db.insert(schema.decisionHistory).values({
        id: randomUUID(),
        decisionId: row.id,
        questionTitle: row.questionTitle,
        questionBody: withReason(row.questionBody, review.verdict, review.reason),
        answer: row.currentAnswer,
        answerKind: row.answerKind,
        recordedAt: now,
      });

      if (review.verdict === "reconfirm") {
        await db
          .update(schema.decisions)
          .set({ settledAt: now, updatedAt: now })
          .where(eq(schema.decisions.id, row.id));
        continue;
      }

      await db
        .update(schema.decisions)
        .set({
          questionTitle: review.title ?? row.questionTitle,
          questionBody: review.body ?? row.questionBody,
          offeredChoicesJson: JSON.stringify(review.choices),
          recommendedAnswer: review.recommendedAnswer ?? row.recommendedAnswer,
          currentAnswer: null,
          answerKind: null,
          dispositionTarget: null,
          settledAt: null,
          reopenedAt: now,
          updatedAt: now,
        })
        .where(eq(schema.decisions.id, row.id));
    }
  }

  /** The tree as the interviewer reads it, keys and all. */
  async function snapshots(
    current: DecisionRow[],
  ): Promise<DecisionSnapshot[]> {
    const keyById = new Map(current.map((row) => [row.id, portKey(row)]));
    const states = deriveTreeStates(treeFacts(current));

    const history = current.length
      ? await db
          .select()
          .from(schema.decisionHistory)
          .where(
            inArray(
              schema.decisionHistory.decisionId,
              current.map((row) => row.id),
            ),
          )
          .orderBy(schema.decisionHistory.recordedAt)
      : [];

    return current.map((row) => {
      const kind = portAnswerKind(row);
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
        state: states.get(row.id) ?? "blocked",
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
}

/** The history row's copy of the question, with why the decision was revisited. */
function withReason(body: string, verdict: string, reason: string): string {
  if (reason.trim() === "") return body;
  return `${body}${REVIEW_REASON_MARKER} (${verdict}): ${reason}`;
}
