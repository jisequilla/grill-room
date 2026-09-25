import {
  actionErrorMessage,
  useActionMutation,
  useActionQuery,
} from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import {
  IconArrowRight,
  IconCircleCheck,
  IconFlag,
  IconSparkles,
} from "@tabler/icons-react";
import { useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router";
import { toast } from "sonner";

import { LooseEndList } from "@/components/workspace/loose-end-list";
import { Markdown } from "@/components/workspace/markdown";
import { ReplacedDecisions } from "@/components/workspace/replaced-decisions";
import { TurnAttemptLog, type Turn } from "@/components/workspace/turn-attempt-log";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { actionErrorCode, type TreeDecision } from "@/lib/decisions";

/** The interviewer's closing summary, which is the thing being confirmed. */
function Summary({
  icon,
  title,
  summary,
}: {
  icon: React.ReactNode;
  title: string;
  summary: string | null;
}) {
  const t = useT();

  return (
    <section className="rounded-xl border bg-card px-5 py-4">
      <div className="flex items-center gap-2 pb-2.5 text-muted-foreground">
        {icon}
        <h3 className="text-[11px] font-medium tracking-wide uppercase">
          {title}
        </h3>
      </div>
      {summary?.trim() ? (
        <Markdown
          text={summary}
          className="text-sm leading-relaxed text-foreground"
        />
      ) : (
        // The server sets a summary with the state and clears it on the way
        // out, so this is the seam between the two rather than a normal read.
        <p className="text-sm text-muted-foreground italic">
          {t("workspace.noDoneSummary")}
        </p>
      )}
    </section>
  );
}

/** A turn takes about a minute and can take several; the default 60 s cancels it. */
const TURN_TIMEOUT_MS = 10 * 60 * 1000;

/**
 * The end of the interview, pending the user's agreement: what the interviewer
 * says was settled, everything still open, and the one button that closes the
 * session. Confirmation is refused while a loose end remains, so the button
 * says why it is not available rather than failing when pressed.
 */
export function DoneProposedPanel({
  sessionId,
  doneSummary,
  decisions,
  onOpenDecision,
  onContinueInterview,
  isContinuing,
  turn = null,
}: {
  sessionId: string;
  doneSummary: string | null;
  /**
   * The whole tree, so this panel can read pending replacement proposals
   * (`supersession.kind === "replaces-settled"`) and count settled decisions
   * for the check button's visibility, without a second `get-tree` fetch.
   */
  decisions: readonly TreeDecision[];
  onOpenDecision: (decisionId: string) => void;
  onContinueInterview: () => void;
  isContinuing: boolean;
  /**
   * The turn of the session's most recent supersession check (its
   * `supersessionTurnId`), collapsed beside the loose ends it proposed
   * against. The live attempt log while a check runs is shown in the turn
   * status above this panel instead — a running check leaves this panel
   * unrendered, since the session's shared turn status reads working.
   */
  turn?: Turn | null;
}) {
  const t = useT();
  const queryClient = useQueryClient();

  const { data: looseEnds, isLoading } = useActionQuery("list-loose-ends", {
    sessionId,
  });

  const confirm = useActionMutation("confirm-session", {
    onError: (error: unknown) => {
      // The server's list is the truth and the screen's may be a moment old:
      // a refusal means re-reading it, not telling the user off.
      if (actionErrorCode(error) === "loose-ends-remain") {
        void queryClient.invalidateQueries({ queryKey: ["action"] });
        return;
      }
      toast.error(actionErrorMessage(error) ?? t("workspace.confirmFailed"));
    },
  });

  // The same check the done proposal ran, on demand: answering one loose end
  // can be what makes another one obviously already answered, and the scan is
  // worth repeating rather than being a one-shot the user cannot reach.
  const findSuperseded = useActionMutation("find-superseded", {
    timeoutMs: TURN_TIMEOUT_MS,
    onError: (error: unknown) => {
      toast.error(
        actionErrorMessage(error) ?? t("workspace.checkSupersededFailed"),
      );
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ["action"] });
    },
  });

  const remaining = looseEnds?.length ?? 0;
  const blocked = isLoading || remaining > 0;

  // A plain count, not a "did anything change" check: two decisions settled
  // in the same round, with no loose ends, still show the button, and a
  // click may find nothing — the button already allowed that before this.
  const settledCount = decisions.filter(
    (decision) => decision.state === "settled",
  ).length;
  const showCheckButton = remaining > 0 || settledCount >= 2;

  return (
    <div className="space-y-5" data-testid="done-proposed-panel">
      <Summary
        icon={<IconFlag className="size-4" />}
        title={t("workspace.doneProposedTitle")}
        summary={doneSummary}
      />

      <section className="space-y-2.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
            {t("workspace.looseEndsHeading")}
          </h3>
          {showCheckButton ? (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={findSuperseded.isPending}
              onClick={() => findSuperseded.mutate({ sessionId })}
              data-testid="check-superseded"
            >
              {findSuperseded.isPending ? (
                <Spinner className="size-4" />
              ) : (
                <IconSparkles className="size-4" />
              )}
              {t(
                findSuperseded.isPending
                  ? "workspace.checkingSuperseded"
                  : "workspace.checkSuperseded",
              )}
            </Button>
          ) : null}
        </div>
        <LooseEndList
          looseEnds={looseEnds ?? []}
          isLoading={isLoading}
          onOpenDecision={onOpenDecision}
          onContinueInterview={onContinueInterview}
          isContinuing={isContinuing}
        />
        <TurnAttemptLog turn={turn} />
      </section>

      <ReplacedDecisions decisions={decisions} onOpenDecision={onOpenDecision} />

      <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4">
        <p className="min-w-0 flex-1 text-sm text-muted-foreground">
          {isLoading
            ? t("workspace.looseEndsChecking")
            : remaining > 0
              ? t("workspace.confirmBlocked", { count: remaining })
              : t("workspace.confirmReady")}
        </p>
        <Button
          type="button"
          disabled={blocked || confirm.isPending}
          onClick={() => confirm.mutate({ sessionId })}
          data-testid="confirm-session"
        >
          {confirm.isPending && <Spinner className="size-4" />}
          {t("workspace.confirmSession")}
        </Button>
      </div>
    </div>
  );
}

/** A confirmed session: the interview is over and the output is what is left. */
export function ConfirmedPanel({
  sessionId,
  doneSummary,
}: {
  sessionId: string;
  doneSummary: string | null;
}) {
  const t = useT();

  return (
    <div className="space-y-5" data-testid="confirmed-panel">
      <Summary
        icon={
          <IconCircleCheck className="size-4 text-emerald-700 dark:text-emerald-300" />
        }
        title={t("workspace.confirmedTitle")}
        summary={doneSummary}
      />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="min-w-0 flex-1 text-sm text-muted-foreground">
          {t("workspace.confirmedMeaning")}
        </p>
        <Button asChild>
          <Link to={`/sessions/${sessionId}/output`}>
            {t("workspace.openOutput")}
            <IconArrowRight className="size-4" />
          </Link>
        </Button>
      </div>

      <p className="border-t pt-4 text-xs text-muted-foreground">
        {t("workspace.confirmedBanner")}
      </p>
    </div>
  );
}
