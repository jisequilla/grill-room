import {
  actionErrorMessage,
  useActionMutation,
} from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import { IconLink } from "@tabler/icons-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import type { TreeDecision } from "@/lib/decisions";

/**
 * One settled decision a later decision proposed replacing, shown with the
 * same inset band the loose-end list's `Supersession` card uses — reused
 * exactly, not restyled, since `gr-yys.3` restyles both together.
 */
function ReplacedDecision({
  decision,
  onOpenDecision,
}: {
  decision: TreeDecision;
  onOpenDecision: (decisionId: string) => void;
}) {
  const t = useT();
  const supersession = decision.supersession;

  const accept = useActionMutation("accept-supersession", {
    onError: (error: unknown) => {
      toast.error(
        actionErrorMessage(error) ?? t("workspace.acceptSupersessionFailed"),
      );
    },
  });

  const dismiss = useActionMutation("dismiss-supersession", {
    onError: (error: unknown) => {
      toast.error(
        actionErrorMessage(error) ?? t("workspace.dismissSupersessionFailed"),
      );
    },
  });

  const busy = accept.isPending || dismiss.isPending;

  if (!supersession) return null;

  return (
    <li
      className="px-4 py-3"
      data-testid="replacement"
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
        data-testid="supersession"
      >
        <p className="flex items-start gap-1.5 text-xs font-medium">
          <IconLink className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
          <span>
            {t("workspace.replacedBy", {
              title: supersession.byTitle ?? t("workspace.replacedByUnknown"),
            })}
          </span>
        </p>
        {supersession.reason ? (
          <p className="text-xs text-muted-foreground">
            {supersession.reason}
          </p>
        ) : null}
        <div className="flex justify-end gap-2">
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={busy}
            onClick={() => dismiss.mutate({ decisionId: decision.id })}
            data-testid="dismiss-replacement"
          >
            {t("workspace.dismissSupersession")}
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={busy}
            onClick={() => accept.mutate({ decisionId: decision.id })}
            data-testid="accept-replacement"
          >
            {accept.isPending && <Spinner className="size-4" />}
            {t("workspace.acceptSupersession")}
          </Button>
        </div>
      </div>
    </li>
  );
}

/**
 * Settled decisions a later decision proposed replacing, pending the user's
 * agreement: the "replaces-settled" half of `find-superseded`'s proposals, as
 * opposed to the loose-end list's "answers-loose-end" half. Rendered as a
 * hairline-separated list after the loose ends (and its attempt log), before
 * the confirm row — a pending proposal never blocks confirmation, so this
 * group is informational only. Renders nothing while no decision carries one.
 */
export function ReplacedDecisions({
  decisions,
  onOpenDecision,
}: {
  decisions: readonly TreeDecision[];
  onOpenDecision: (decisionId: string) => void;
}) {
  const t = useT();

  const pending = decisions.filter(
    (decision) => decision.supersession?.kind === "replaces-settled",
  );

  if (pending.length === 0) return null;

  return (
    <section className="space-y-2.5" data-testid="replaced-decisions">
      <h3 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
        {t("workspace.replacedDecisionsHeading")}
      </h3>
      <ul className="flex flex-col divide-y divide-border/60">
        {pending.map((decision) => (
          <ReplacedDecision
            key={decision.id}
            decision={decision}
            onOpenDecision={onOpenDecision}
          />
        ))}
      </ul>
    </section>
  );
}
