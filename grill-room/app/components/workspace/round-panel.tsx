import { useT } from "@agent-native/core/client/i18n";
import { useState } from "react";

import {
  ConfirmedPanel,
  DoneProposedPanel,
} from "@/components/workspace/done-panel";
import { BatchProgressPanel } from "@/components/workspace/batch/batch-progress-panel";
import { ReviewDigestPanel } from "@/components/workspace/review-digest";
import { RoundCard } from "@/components/workspace/round-card";
import { RoundNudge } from "@/components/workspace/round-nudge";
import {
  NextRoundPanel,
  StartInterviewPanel,
  TurnFailedPanel,
  TurnWorkingPanel,
} from "@/components/workspace/turn-panels";
import type { Turn } from "@/components/workspace/turn-attempt-log";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import type { TreeDecision } from "@/lib/decisions";
import { roundCardAnchorId } from "@/lib/review-digest";

type RoundResult = AgentNativeActionRegistry["get-current-round"]["result"];
type Card = NonNullable<RoundResult["round"]>["decisions"][number];

const LOOSE_END_DRAFT_KINDS: readonly string[] = [
  "unknown",
  "pushed-back",
  "deferred",
  "prototype-flagged",
];

/**
 * Answered, answered-but-still-open, and unanswered, so the footer says at a
 * glance what a submit would actually settle.
 */
function dotColour(draft: Card["draft"]): string {
  if (!draft) return "bg-muted-foreground/25";
  return LOOSE_END_DRAFT_KINDS.includes(draft.answerKind)
    ? "bg-owed"
    : "bg-settled";
}

export function RoundPanel({
  round,
  isLoading,
  hasDecisions,
  decisions,
  lastSubmittedAt,
  activeTurn,
  staleReviewTurn,
  supersessionTurn,
  onRequestNextRound,
  isRequesting,
  onSubmit,
  isSubmitting,
  onOpenDecision,
}: {
  round: RoundResult | undefined;
  isLoading: boolean;
  /** Whether the session's tree holds anything yet, which decides the empty copy. */
  hasDecisions: boolean;
  /** The whole tree, history included — what the "what changed" digest reads. */
  decisions: readonly TreeDecision[];
  /** The most recently submitted round's timestamp, or null when none yet. */
  lastSubmittedAt: string | null;
  /**
   * The turn the session's current turn status belongs to, of any kind —
   * whichever one is actually running or just stopped: a round proposal, a
   * readiness judgment, a stale review, or a supersession check. Feeds the
   * attempt log on the working and failed panels, which show whichever kind
   * is live rather than assuming a round proposal.
   */
  activeTurn: Turn | null;
  /** The session's most recent stale review turn, collapsed beside the what-changed digest. */
  staleReviewTurn: Turn | null;
  /** The session's most recent supersession check turn, collapsed beside the loose ends it proposed. */
  supersessionTurn: Turn | null;
  onRequestNextRound: () => void;
  isRequesting: boolean;
  onSubmit: (roundId: string) => void;
  isSubmitting: boolean;
  /** Opens the decision sheet, which is how a loose end is read in full. */
  onOpenDecision: (decisionId: string) => void;
}) {
  const t = useT();
  // The card the user is working on. An answered card folds to its question
  // and its answer, so a long round stays readable — but never the one just
  // interacted with, which would pull the answer out from under them.
  const [expandedId, setExpandedId] = useState<string | null>(null);

  if (isLoading || !round) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-40 w-full rounded-xl" />
        <Skeleton className="h-40 w-full rounded-xl" />
      </div>
    );
  }

  // What a recent reopen put in doubt, above whatever the round itself is
  // showing: a turn working or failed, the interview's ending, or the cards.
  // Present throughout rather than only alongside cards, since it can name a
  // dependent that will not resurface as a card at all (a reconfirm) or one
  // that resurfaces only once the interviewer's next turn opens a round for
  // it.
  // A batch of reopens holds the session for many turns at a time; this says
  // which of the user's own changes the turn below belongs to. Above the
  // digest, because the digest is what the batch is producing.
  const batch = <BatchProgressPanel sessionId={round.sessionId} />;

  const digest = (
    <ReviewDigestPanel
      sessionId={round.sessionId}
      decisions={decisions}
      lastSubmittedAt={lastSubmittedAt}
      openRoundDecisionIds={
        new Set((round.round?.decisions ?? []).map((card) => card.id))
      }
      onOpenDecision={onOpenDecision}
      turn={staleReviewTurn}
    />
  );

  // The stored status, not the pending promise: a turn outlives the request
  // that started it, so a reload mid-turn must land here too.
  if (round.turnStatus === "working") {
    return (
      <div>
        {batch}
        {digest}
        <TurnWorkingPanel startedAt={round.turnStartedAt} turn={activeTurn} />
      </div>
    );
  }

  if (round.turnStatus === "failed") {
    return (
      <div>
        {batch}
        {digest}
        <TurnFailedPanel
          error={round.turnError}
          onRetry={onRequestNextRound}
          isPending={isRequesting}
          turn={activeTurn}
        />
      </div>
    );
  }

  // The session's own state outranks whatever round is lying around: once the
  // interviewer has proposed done, the centre panel is the ending, not cards.
  if (round.state === "done-proposed") {
    return (
      <div>
        {batch}
        {digest}
        <DoneProposedPanel
          sessionId={round.sessionId}
          doneSummary={round.doneSummary}
          onOpenDecision={onOpenDecision}
          onContinueInterview={onRequestNextRound}
          isContinuing={isRequesting}
          turn={supersessionTurn}
        />
      </div>
    );
  }

  if (round.state === "confirmed") {
    return (
      <div>
        {batch}
        {digest}
        <ConfirmedPanel
          sessionId={round.sessionId}
          doneSummary={round.doneSummary}
        />
      </div>
    );
  }

  if (!round.round) {
    return (
      <div>
        {batch}
        {digest}
        {hasDecisions ? (
          <NextRoundPanel onRequest={onRequestNextRound} isPending={isRequesting} />
        ) : (
          <StartInterviewPanel onStart={onRequestNextRound} isPending={isRequesting} />
        )}
      </div>
    );
  }

  const cards = round.round.decisions;
  const answered = cards.filter((card) => card.draft !== null).length;
  const complete = cards.length > 0 && answered === cards.length;
  const roundId = round.round.id;

  return (
    <div>
      {batch}
      {digest}
      <RoundNudge sessionId={round.sessionId} />
      {/* The stack clears the submit bar's own height, so the last card can be
          scrolled out from under it rather than read through it. */}
      <div className="space-y-3 pb-20">
        {cards.map((card, index) => (
          <div key={card.id} id={roundCardAnchorId(card.id)}>
            <RoundCard
              card={card}
              index={index}
              disabled={isSubmitting}
              foldable={cards.length > 1}
              expanded={expandedId === card.id}
              onExpandedChange={(open) => setExpandedId(open ? card.id : null)}
            />
          </div>
        ))}
      </div>

      {/* Opaque, not translucent: a translucent bar renders the chips beneath
          it as legible ghosts, which reads as a rendering fault. */}
      <div className="sticky bottom-0 -mx-1 flex items-center justify-between gap-4 rounded-t-xl border-t bg-background px-5 py-3">
        <div className="flex items-center gap-3">
          <div
            className="flex gap-1"
            role="img"
            aria-label={t("workspace.progress", {
              answered,
              total: cards.length,
            })}
          >
            {cards.map((card) => (
              <span
                key={card.id}
                className={`h-1.5 w-5 rounded-full ${dotColour(card.draft)}`}
              />
            ))}
          </div>
          <span
            className="text-sm text-muted-foreground tabular-nums"
            data-testid="round-progress"
          >
            {t("workspace.progress", { answered, total: cards.length })}
          </span>
        </div>
        <Button
          type="button"
          disabled={!complete || isSubmitting}
          onClick={() => onSubmit(roundId)}
        >
          {isSubmitting && <Spinner className="size-4" />}
          {t(isSubmitting ? "workspace.submitting" : "workspace.submitRound")}
        </Button>
      </div>
    </div>
  );
}
