import {
  actionErrorMessage,
  useActionMutation,
} from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import { IconClockPause } from "@tabler/icons-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import type { TreeDecision } from "@/lib/decisions";

/**
 * One settled own answer the interviewer read as a deferral, shown with the
 * same inset band `ReplacedDecisions` uses: the owner's answer, the
 * interviewer's reason, and the choice to accept or dismiss it.
 */
function DeferralProposal({
  decision,
  onOpenDecision,
}: {
  decision: TreeDecision;
  onOpenDecision: (decisionId: string) => void;
}) {
  const t = useT();

  const accept = useActionMutation("accept-deferral", {
    onError: (error: unknown) => {
      toast.error(actionErrorMessage(error) ?? t("workspace.acceptDeferralFailed"));
    },
  });

  const dismiss = useActionMutation("dismiss-deferral", {
    onError: (error: unknown) => {
      toast.error(
        actionErrorMessage(error) ?? t("workspace.dismissDeferralFailed"),
      );
    },
  });

  const busy = accept.isPending || dismiss.isPending;

  if (!decision.deferralReason) return null;

  return (
    <li
      className="px-4 py-3"
      data-testid="deferral-proposal"
      data-decision-id={decision.id}
    >
      <button
        type="button"
        onClick={() => onOpenDecision(decision.id)}
        className="rounded-sm text-left text-sm leading-snug font-medium hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
      >
        {decision.questionTitle}
      </button>
      {decision.answer?.text ? (
        <p className="mt-0.5 text-xs text-muted-foreground">
          {decision.answer.text}
        </p>
      ) : null}

      <div
        className="mt-2.5 w-full space-y-2 rounded-lg border bg-muted/30 p-3"
        data-testid="deferral-band"
      >
        <p className="flex items-start gap-1.5 text-xs font-medium">
          <IconClockPause className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
          <span>{t("workspace.deferralWaitsOn")}</span>
        </p>
        <p className="text-xs text-muted-foreground">{decision.deferralReason}</p>
        <div className="flex justify-end gap-2">
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={busy}
            onClick={() => dismiss.mutate({ decisionId: decision.id })}
            data-testid="deferral-dismiss"
          >
            {t("workspace.dismissDeferral")}
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={busy}
            onClick={() => accept.mutate({ decisionId: decision.id })}
            data-testid="deferral-accept"
          >
            {accept.isPending && <Spinner className="size-4" />}
            {t("workspace.acceptDeferral")}
          </Button>
        </div>
      </div>
    </li>
  );
}

/**
 * Settled own answers the interviewer read as postponing their question rather
 * than deciding it, pending the user's agreement. Rendered after the replaced
 * decisions, before the confirm row: a pending deferral never blocks
 * confirmation, but accepting one turns the decision into a deferred loose end
 * that does. Renders nothing while no decision carries one.
 */
export function DeferralProposals({
  decisions,
  onOpenDecision,
}: {
  decisions: readonly TreeDecision[];
  onOpenDecision: (decisionId: string) => void;
}) {
  const t = useT();

  const pending = decisions.filter((decision) => decision.deferralReason);

  if (pending.length === 0) return null;

  return (
    <section className="space-y-2.5" data-testid="deferral-proposals">
      <h3 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
        {t("workspace.deferralProposalsHeading")}
      </h3>
      <ul className="flex flex-col divide-y divide-border/60">
        {pending.map((decision) => (
          <DeferralProposal
            key={decision.id}
            decision={decision}
            onOpenDecision={onOpenDecision}
          />
        ))}
      </ul>
    </section>
  );
}
