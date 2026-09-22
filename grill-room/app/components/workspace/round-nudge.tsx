import {
  actionErrorMessage,
  useActionMutation,
  useActionQuery,
} from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import { IconLayoutGrid } from "@tabler/icons-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { ROUND_NUDGE_THRESHOLD, shouldShowRoundNudge } from "@/lib/round-nudge";

import type { SessionAnsweringMode } from "@shared/session-constants";

function storageKey(sessionId: string): string {
  return `grill-room:round-nudge:dismissed:${sessionId}`;
}

function readDismissedAtRoundCount(sessionId: string): number | null {
  try {
    const raw = window.localStorage.getItem(storageKey(sessionId));
    if (raw === null) return null;
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function writeDismissedAtRoundCount(sessionId: string, roundCount: number): void {
  try {
    window.localStorage.setItem(storageKey(sessionId), String(roundCount));
  } catch {
    // Ignore storage access errors; the notice just keeps showing.
  }
}

/**
 * A quiet, dismissible notice above the round cards, offered once
 * one-at-a-time answering has produced {@link ROUND_NUDGE_THRESHOLD}
 * single-card rounds in a row — see `round-nudge.ts` for why.
 *
 * Self-sufficient on `sessionId` alone: `RoundPanel` does not otherwise carry
 * the session's answering mode or its round history, so this reads both
 * itself rather than asking the route to thread more props through.
 */
export function RoundNudge({ sessionId }: { sessionId: string }) {
  const t = useT();
  const [ready, setReady] = useState(false);
  const [dismissedAtRoundCount, setDismissedAtRoundCount] = useState<
    number | null
  >(null);

  useEffect(() => {
    setDismissedAtRoundCount(readDismissedAtRoundCount(sessionId));
    setReady(true);
  }, [sessionId]);

  const { data: session } = useActionQuery("get-session", { id: sessionId });
  const { data: rounds } = useActionQuery("list-rounds", { sessionId });

  const switchMode = useActionMutation("set-session-answering-mode", {
    onError: (error: unknown) => {
      toast.error(actionErrorMessage(error) ?? t("workspace.draftFailed"));
    },
  });

  // Read after mount only, so the server-rendered and first client render
  // agree (neither has seen localStorage yet) and the notice never flashes
  // visible before immediately hiding once a past dismissal loads.
  if (!ready || !session || !rounds) return null;

  const submittedRounds = rounds.rounds
    .filter((round) => round.submissionState === "submitted")
    .map((round) => ({ cardCount: round.decisions.length }));

  const visible = shouldShowRoundNudge({
    answeringMode: session.answeringMode as SessionAnsweringMode,
    submittedRounds,
    dismissedAtRoundCount,
  });

  if (!visible) return null;

  function dismiss() {
    writeDismissedAtRoundCount(sessionId, submittedRounds.length);
    setDismissedAtRoundCount(submittedRounds.length);
  }

  return (
    <div
      className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-card/50 px-4 py-3"
      data-testid="round-nudge"
    >
      <div className="flex min-w-0 items-start gap-2.5">
        <IconLayoutGrid className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
        <p className="text-sm text-muted-foreground">
          {t("workspace.roundNudgeMessage")}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <Button type="button" size="sm" variant="ghost" onClick={dismiss}>
          {t("workspace.roundNudgeKeep")}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={switchMode.isPending}
          onClick={() =>
            switchMode.mutate(
              { id: sessionId, answeringMode: "whole-round" },
              { onSuccess: dismiss },
            )
          }
        >
          {t("workspace.roundNudgeSwitch")}
        </Button>
      </div>
    </div>
  );
}
