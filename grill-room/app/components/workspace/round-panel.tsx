import { useT } from "@agent-native/core/client/i18n";

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

export function RoundPanel({
  round,
  isLoading,
  hasDecisions,
  onRequestNextRound,
  isRequesting,
  onSubmit,
  isSubmitting,
}: {
  round: RoundResult | undefined;
  isLoading: boolean;
  /** Whether the session's tree holds anything yet, which decides the empty copy. */
  hasDecisions: boolean;
  onRequestNextRound: () => void;
  isRequesting: boolean;
  onSubmit: (roundId: string) => void;
  isSubmitting: boolean;
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
    <div className="space-y-3">
      {cards.map((card, index) => (
        <RoundCard
          key={card.id}
          card={card}
          index={index}
          disabled={isSubmitting}
        />
      ))}

      <div className="sticky bottom-0 -mx-1 flex items-center justify-between gap-4 rounded-t-xl border-t bg-background/85 px-5 py-3 backdrop-blur">
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
                className={
                  card.draft
                    ? "h-1.5 w-5 rounded-full bg-emerald-600 dark:bg-emerald-400"
                    : "h-1.5 w-5 rounded-full bg-muted-foreground/25"
                }
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
