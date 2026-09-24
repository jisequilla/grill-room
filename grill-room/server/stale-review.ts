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
 * `reopenedAt` is never cleared. It is the whole of what makes a dependent
 * stale, so it has to outlive the reopened decision's new answer: the
 * dependents stay in doubt from the reopen until this review gives each of
 * them a `settledAt` later than it, or takes their answer away entirely.
 *
 * Everything the review needs lives here rather than in the actions, so the
 * seam with `request-next-round` is a single call.
 */
import { randomUUID } from "node:crypto";

import { eq } from "@agent-native/core/db/schema";

import { getDb, schema } from "./db/index.js";
import { getInterviewer } from "./interviewer/index.js";
import type { ReviewStaleResult } from "./interviewer/index.js";
import {
  deriveTreeStates,
  recommendedChoiceRejection,
  transitiveDependencies,
  treeFacts,
  type TreeDecision,
} from "./tree.js";
import {
  askUntilAccepted,
  decisionSnapshots,
  MAX_TURN_RETRIES,
  portKey,
  runTurn,
  TurnRejected,
} from "./turn.js";
import type { AttemptRecorder } from "./turn-recorder.js";

/** One review turn's worth of work: a reopened decision and what it put in doubt. */
export interface DueStaleReview {
  /** The decision that was reopened and has since been answered again. */
  reopenedId: string;
  /** The stale decisions hanging off it, in the order they were given. */
  staleIds: string[];
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

    for (const ancestorId of transitiveDependencies(decision.id, byId)) {
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

  for (const review of result.reviews) {
    const rejection = recommendedChoiceRejection({
      key: review.decisionKey,
      dependsOn: [],
      ask: false,
      choices: review.choices,
      recommendedChoice: review.recommendedChoice,
    });
    if (rejection) reasons.push(rejection);
  }

  return reasons;
}

/**
 * Run every stale review the session is due, and apply the verdicts.
 *
 * Called by `request-next-round` before it asks the interviewer for anything,
 * so a reopened decision's dependents are judged before the interview moves
 * on. That is the one place every path reaches: a round submission ends there,
 * and so does a loose end answered outside a round. Does nothing at all — not
 * even a turn status — when nothing is stale, which is every ordinary round.
 */
export async function runDueStaleReviews(sessionId: string): Promise<void> {
  const db = getDb();

  const loadDecisions = () =>
    db
      .select()
      .from(schema.decisions)
      .where(eq(schema.decisions.sessionId, sessionId))
      // `createdAt` has millisecond precision; id as a final tie-break keeps
      // review-group order deterministic when two decisions land in the same
      // millisecond.
      .orderBy(schema.decisions.createdAt, schema.decisions.id);

  let rows = await loadDecisions();
  let due = dueStaleReviews(treeFacts(rows));
  if (due.length === 0) return;

  const [session] = await db
    .select()
    .from(schema.sessions)
    .where(eq(schema.sessions.id, sessionId))
    .limit(1);

  if (!session) return;

  await runTurn({
    sessionId,
    failedMessage: "The stale review turn failed.",
    record: { turnKind: "review-stale", model: session.model },
    take: async (recorder) => {
      let conversationId = session.conversationId;

      // Each turn takes its group out of the stale set, so the list shrinks;
      // the bound only stops a pathological tree from looping.
      for (let guard = rows.length + 1; due.length > 0 && guard > 0; guard -= 1) {
        const turn = await reviewOne(
          due[0] as DueStaleReview,
          conversationId,
          recorder,
        );
        conversationId = turn.conversationId;
        await applyReviews(turn.result);
        rows = await loadDecisions();
        due = dueStaleReviews(treeFacts(rows));
      }

      await db
        .update(schema.sessions)
        .set({
          staleReviewTurnId: recorder?.turnId ?? null,
          updatedAt: new Date().toISOString(),
        })
        .where(eq(schema.sessions.id, sessionId));

      return conversationId ?? "";
    },
  });

  /**
   * One review turn, retried with the app's reasons while the interviewer rules
   * on the wrong set of decisions. Nothing is written until a result is
   * accepted whole, so a rejected one leaves the tree exactly as it was.
   */
  async function reviewOne(
    group: DueStaleReview,
    resumeFrom: string | null,
    recorder: AttemptRecorder | null,
  ): Promise<{ result: ReviewStaleResult; conversationId: string }> {
    const interviewer = getInterviewer();
    const byId = new Map(rows.map((row) => [row.id, row]));
    const keyOf = (id: string) => {
      const row = byId.get(id);
      return row ? portKey(row) : id;
    };
    const staleKeys = group.staleIds.map(keyOf);

    return askUntilAccepted<ReviewStaleResult>({
      conversationId: resumeFrom,
      recorder,
      ask: async ({ conversationId, rejectionReason, observer }) =>
        interviewer.reviewStale(
          {
            kind: "review-stale",
            context: {
              idea: session!.idea,
              title: session!.title,
              model: session!.model,
              answeringMode: session!.answeringMode,
              docsFolder: session!.docsFolder,
              conversationId,
              decisions: await decisionSnapshots(await loadDecisions()),
            },
            reopenedDecisionKey: keyOf(group.reopenedId),
            staleDecisionKeys: staleKeys,
            rejectionReason,
          },
          observer,
        ),
      reasonsToRefuse: (result) => reviewRejectionReasons(staleKeys, result),
      exhausted: (lastReason) =>
        new TurnRejected(
          "invalid-review",
          `The interviewer reviewed the stale decisions wrongly ${MAX_TURN_RETRIES + 1} times. Last reason: ${lastReason}`,
        ),
    });
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
        questionBody: row.questionBody,
        answer: row.currentAnswer,
        answerKind: row.answerKind,
        interviewerReason:
          review.reason.trim() === "" ? null : review.reason,
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
          offeredChoicesJson: JSON.stringify(
            review.choices.map((choice) => choice.label),
          ),
          choiceRationalesJson: JSON.stringify(
            review.choices.map((choice) => choice.rationale),
          ),
          recommendedChoice: review.recommendedChoice,
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
}
