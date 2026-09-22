import { useT } from "@agent-native/core/client/i18n";

import {
  ConfirmedPanel,
  DoneProposedPanel,
} from "@/components/workspace/done-panel";
import { RoundCard } from "@/components/workspace/round-card";
import {
  NextRoundPanel,
  StartInterviewPanel,
  TurnFailedPanel,
  TurnWorkingPanel,
} from "@/components/workspace/turn-panels";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";

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
    ? "bg-orange-500 dark:bg-orange-400"
    : "bg-emerald-600 dark:bg-emerald-400";
}

export function RoundPanel({
  round,
  isLoading,
  hasDecisions,
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
  onRequestNextRound: () => void;
  isRequesting: boolean;
  onSubmit: (roundId: string) => void;
  isSubmitting: boolean;
  /** Opens the decision sheet, which is how a loose end is read in full. */
  onOpenDecision: (decisionId: string) => void;
}) {
  const t = useT();

  if (isLoading || !round) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-40 w-full rounded-xl" />
        <Skeleton className="h-40 w-full rounded-xl" />
      </div>
    );
  }

  // The stored status, not the pending promise: a turn outlives the request
  // that started it, so a reload mid-turn must land here too.
  if (round.turnStatus === "working") {
    return <TurnWorkingPanel startedAt={round.turnStartedAt} />;
  }

  if (round.turnStatus === "failed") {
    return (
      <TurnFailedPanel
        error={round.turnError}
        onRetry={onRequestNextRound}
        isPending={isRequesting}
      />
    );
  }

  // The session's own state outranks whatever round is lying around: once the
  // interviewer has proposed done, the centre panel is the ending, not cards.
  if (round.state === "done-proposed") {
    return (
      <DoneProposedPanel
        sessionId={round.sessionId}
        doneSummary={round.doneSummary}
        onOpenDecision={onOpenDecision}
        onContinueInterview={onRequestNextRound}
        isContinuing={isRequesting}
      />
    );
  }

  if (round.state === "confirmed") {
    return (
      <ConfirmedPanel
        sessionId={round.sessionId}
        doneSummary={round.doneSummary}
      />
    );
  }

  if (!round.round) {
    return hasDecisions ? (
      <NextRoundPanel
        onRequest={onRequestNextRound}
        isPending={isRequesting}
      />
    ) : (
      <StartInterviewPanel
        onStart={onRequestNextRound}
        isPending={isRequesting}
      />
    );
  }

  const cards = round.round.decisions;
  const answered = cards.filter((card) => card.draft !== null).length;
  const complete = cards.length > 0 && answered === cards.length;
  const roundId = round.round.id;

  return (
    <div>
      {/* The stack clears the submit bar's own height, so the last card can be
          scrolled out from under it rather than read through it. */}
      <div className="space-y-3 pb-20">
        {cards.map((card, index) => (
          <RoundCard
            key={card.id}
            card={card}
            index={index}
            disabled={isSubmitting}
          />
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
