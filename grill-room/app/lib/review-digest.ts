/**
 * "What changed" digest for a stale review: derived entirely from the tree
 * `get-tree` already returns, no action and no schema of its own.
 *
 * `server/stale-review.ts` is the source of truth this mirrors. Reopening a
 * decision stamps `reopenedAt` on it, which puts every transitive dependent
 * in doubt; the next time the reopened decision settles again, the
 * interviewer rules on each dependent, reconfirming it (kept as-is, settled
 * again) or re-asking it (cleared, returned to the frontier under an updated
 * question). Both verdicts are written as a `decisionHistory` row carrying a
 * non-empty `interviewerReason` — the one other thing that writes such a row
 * is a push-back response, see {@link classifyHistoryEntry}.
 *
 * Two things live here: {@link classifyHistoryEntry} reads a single history
 * row of one decision and says whether it was a reconfirm or a re-ask, for
 * labelling a decision's own history (the detail sheet, round history).
 * {@link reviewEvents} groups those verdicts by the reopen that caused them,
 * for the digest panel.
 */
import type { DecisionAnswerKind, TreeDecision } from "@/lib/decisions";

export type HistoryEntry = TreeDecision["previousAnswers"][number];

export type ReviewVerdict = "reconfirm" | "re-ask";

/**
 * Whether `previousAnswers[index]` of `decision` is a stale-review verdict,
 * and if so which one. Null when the entry is not a review row at all — the
 * user's own doing (a reopen, a return from deferral, a disposition) leaves
 * `interviewerReason` empty — or when it is a push-back's response rather
 * than a stale review's, see below.
 *
 * `stale-review.ts` logs the answer as it stood *before* applying a verdict,
 * so a reconfirm's row and a re-ask's row are identical in isolation: only
 * what happens next tells them apart. "What happens next" is the following
 * history entry's own logged answer when there is one — itself a snapshot of
 * the live answer just before *that* entry was written — or the decision's
 * current answer when this is the last entry. A reconfirm leaves the answer
 * exactly as this entry found it; a re-ask clears it (or, once the decision
 * is answered again and something later writes a further entry, the answer
 * by then differs from what this entry recorded).
 *
 * A push-back response also writes a non-empty `interviewerReason` (why the
 * pushed-back decision was withdrawn, replaced, or restructured — see the
 * `decisionHistory` schema comment) and nothing distinguishes that row from a
 * review row by shape alone. Withdrawal is terminal, though: a withdrawn
 * decision leaves the tree and nothing is ever recorded against it again, so
 * the *last* history entry of a withdrawn decision is always the push-back's
 * own verdict, never a stale review's. That is excluded here; an earlier
 * entry of the same decision (from before it was ever pushed back) is not.
 */
export function classifyHistoryEntry(
  decision: Pick<TreeDecision, "answer" | "previousAnswers" | "withdrawnAt">,
  index: number,
): ReviewVerdict | null {
  const entries = decision.previousAnswers;
  const entry = entries[index];
  if (!entry || !entry.interviewerReason || entry.interviewerReason.trim() === "") {
    return null;
  }

  if (decision.withdrawnAt != null && index === entries.length - 1) {
    return null;
  }

  const next = entries[index + 1];
  const followingText = next ? next.text : (decision.answer?.text ?? null);
  const followingKind = next ? next.kind : (decision.answer?.kind ?? null);

  const unchanged = followingKind === entry.kind && followingText === entry.text;
  return unchanged ? "reconfirm" : "re-ask";
}

/** Every transitive dependency of `id`: what `id` would go stale under. */
function transitiveAncestors(
  id: string,
  byId: ReadonlyMap<string, TreeDecision>,
): Set<string> {
  const seen = new Set<string>();
  const queue = [...(byId.get(id)?.dependsOn ?? [])];

  while (queue.length > 0) {
    const next = queue.shift();
    if (next === undefined || seen.has(next)) continue;
    seen.add(next);
    const node = byId.get(next);
    if (node) queue.push(...node.dependsOn);
  }

  return seen;
}

/** One decision the reopen put in doubt, and how the interviewer ruled on it. */
export interface ReviewedDependent {
  decisionId: string;
  verdict: ReviewVerdict;
  /** The interviewer's reason. Never empty — that is what made this a verdict. */
  reason: string;
  recordedAt: string;
  /**
   * The question exactly as it read when this verdict was recorded — a
   * re-ask can reword the question afterward, so this is not always what the
   * decision reads now.
   */
  title: string;
  /**
   * The decision's current title, when a re-ask left it reading differently
   * from `title` above. Null for a reconfirm, and for a re-ask whose question
   * went unchanged: those have nothing to point out.
   */
  retitledTo: string | null;
}

/** One reopen and everything the review that followed it settled. */
export interface ReviewEvent {
  /** `${reopenedId}@${reopenedAt}`, unique across a decision reopened more than once. */
  id: string;
  reopenedId: string;
  reopenedAt: string;
  /** What the reopened decision used to say, read off its own reopen record. */
  oldAnswer: { text: string | null; kind: DecisionAnswerKind | null } | null;
  /** What it says now. Always set: an event exists only once it has been reanswered. */
  newAnswer: { text: string | null; kind: DecisionAnswerKind } | null;
  /** Oldest first. */
  reviewed: ReviewedDependent[];
}

/**
 * Every review event the tree's current state can account for, newest first.
 *
 * A decision reopened more than once only shows its latest cycle: an earlier
 * reopen's own timestamp is overwritten on the live row (`reopenedAt` is
 * never cleared, but it is a single field), and whatever was reviewed under
 * that earlier reopen was recorded before the later one, so it cannot match
 * the `reopenedAt <= recordedAt` test below. An event only appears once the
 * reopened decision has a real answer again — nothing is reviewable, and
 * nothing to show, before then.
 *
 * When a dependent's history entry could belong to more than one currently
 * reopened ancestor — it depends on two decisions that were both reopened
 * before the entry was recorded — it is grouped under the more recently
 * reopened one, tie-broken by id. This mirrors `dueStaleReviews`'s own choice
 * of which ancestor a stale decision is reviewed under, so a dependent is
 * never attributed to more than one event for the same entry.
 */
export function reviewEvents(decisions: readonly TreeDecision[]): ReviewEvent[] {
  const byId = new Map(decisions.map((decision) => [decision.id, decision]));

  const reviewedByReopenId = new Map<string, ReviewedDependent[]>();

  for (const decision of decisions) {
    const ancestors = transitiveAncestors(decision.id, byId);

    decision.previousAnswers.forEach((entry, index) => {
      const verdict = classifyHistoryEntry(decision, index);
      if (!verdict) return;

      let chosen: TreeDecision | null = null;
      for (const ancestorId of ancestors) {
        const ancestor = byId.get(ancestorId);
        const reopenedAt = ancestor?.reopenedAt;
        if (!ancestor || reopenedAt == null || reopenedAt > entry.recordedAt) {
          continue;
        }
        const bestSoFar = chosen?.reopenedAt ?? "";
        if (
          !chosen ||
          reopenedAt > bestSoFar ||
          (reopenedAt === bestSoFar && ancestorId < chosen.id)
        ) {
          chosen = ancestor;
        }
      }
      if (!chosen) return;

      const list = reviewedByReopenId.get(chosen.id) ?? [];
      list.push({
        decisionId: decision.id,
        verdict,
        reason: entry.interviewerReason as string,
        recordedAt: entry.recordedAt,
        title: entry.questionTitle,
        retitledTo:
          verdict === "re-ask" && entry.questionTitle !== decision.questionTitle
            ? decision.questionTitle
            : null,
      });
      reviewedByReopenId.set(chosen.id, list);
    });
  }

  const events = decisions
    .filter((decision) => decision.reopenedAt != null && decision.answer != null)
    .map((decision): ReviewEvent => {
      const reopenedAt = decision.reopenedAt as string;
      const reopenRecord = decision.previousAnswers.find(
        (entry) => entry.recordedAt === reopenedAt,
      );

      return {
        id: `${decision.id}@${reopenedAt}`,
        reopenedId: decision.id,
        reopenedAt,
        oldAnswer: reopenRecord
          ? { text: reopenRecord.text, kind: reopenRecord.kind }
          : null,
        newAnswer: decision.answer,
        reviewed: (reviewedByReopenId.get(decision.id) ?? []).sort((a, b) =>
          a.recordedAt < b.recordedAt ? -1 : a.recordedAt > b.recordedAt ? 1 : 0,
        ),
      };
    });

  return events.sort((a, b) =>
    a.reopenedAt < b.reopenedAt ? 1 : a.reopenedAt > b.reopenedAt ? -1 : 0,
  );
}

/**
 * When `event`'s review actually finished — the latest of every verdict it
 * carries, or its reopen's own timestamp when it carries none.
 *
 * This is deliberately not `event.reopenedAt`: the round that answers a
 * reopened decision settles it at the same instant that round is submitted,
 * and the stale review that the answer triggers runs immediately afterward,
 * in the very next step of the same `request-next-round` call
 * (`server/stale-review.ts`). Its verdicts are always recorded at or after
 * that submission, never before, so this is always at or after
 * `event.reopenedAt` — comparing against it, rather than the reopen, is what
 * lets the digest show up on the submission that first makes it true instead
 * of hiding on it. `reviewed` is oldest first (see {@link reviewEvents}), so
 * its last entry already carries the latest `recordedAt`.
 */
export function reviewCompletedAt(event: ReviewEvent): string {
  const last = event.reviewed[event.reviewed.length - 1];
  if (!last) return event.reopenedAt;
  return last.recordedAt > event.reopenedAt ? last.recordedAt : event.reopenedAt;
}

/**
 * `events` filtered down to what the digest should actually show right now:
 * newer than both the last dismissal and the last round the user submitted,
 * by {@link reviewCompletedAt} rather than by reopen time. Preserves
 * `events`' own newest-first order.
 */
export function visibleReviewEvents(
  events: readonly ReviewEvent[],
  {
    lastSubmittedAt,
    dismissedReviewedAt,
  }: { lastSubmittedAt: string | null; dismissedReviewedAt: string | null },
): ReviewEvent[] {
  const threshold = [dismissedReviewedAt, lastSubmittedAt].reduce<string>(
    (max, value) => (value != null && value > max ? value : max),
    "",
  );
  return events.filter((event) => reviewCompletedAt(event) > threshold);
}

/** The anchor id `RoundPanel` gives each card, so the digest can link into it. */
export function roundCardAnchorId(decisionId: string): string {
  return `round-card-${decisionId}`;
}

/**
 * The most recent re-ask verdict recorded for `decision` at or before
 * `beforeIso`, if any. Used by the round history to explain why a question
 * that was once settled is being asked again in a given round: the round
 * itself carries no such reason, only the decision's own history does.
 */
export function mostRecentReAskBefore(
  decision: Pick<TreeDecision, "answer" | "previousAnswers" | "withdrawnAt">,
  beforeIso: string,
): { reason: string; recordedAt: string } | null {
  let found: { reason: string; recordedAt: string } | null = null;

  decision.previousAnswers.forEach((entry, index) => {
    if (entry.recordedAt > beforeIso) return;
    if (classifyHistoryEntry(decision, index) !== "re-ask") return;
    if (!found || entry.recordedAt > found.recordedAt) {
      found = { reason: entry.interviewerReason as string, recordedAt: entry.recordedAt };
    }
  });

  return found;
}
