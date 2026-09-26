import {
  actionErrorMessage,
  useActionMutation,
} from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import { IconTextWrap } from "@tabler/icons-react";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import type { TreeDecision } from "@/lib/decisions";

/**
 * One settled own answer the interviewer read as holding more than the
 * decision, shown with the same inset band `DeferralProposal` uses: the
 * owner's answer, the clean statement proposed for it, the notes it takes out
 * (kept in the app, never exported), the reason, and the choice to accept,
 * edit or dismiss it.
 */
function RestatementProposal({
  decision,
  onOpenDecision,
}: {
  decision: TreeDecision;
  onOpenDecision: (decisionId: string) => void;
}) {
  const t = useT();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");

  const accept = useActionMutation("accept-restatement", {
    onSuccess: () => setEditing(false),
    onError: (error: unknown) => {
      toast.error(
        actionErrorMessage(error) ?? t("workspace.acceptRestatementFailed"),
      );
    },
  });

  const dismiss = useActionMutation("dismiss-restatement", {
    onError: (error: unknown) => {
      toast.error(
        actionErrorMessage(error) ?? t("workspace.dismissRestatementFailed"),
      );
    },
  });

  const busy = accept.isPending || dismiss.isPending;

  if (decision.restatementText == null) return null;

  const statement = decision.restatementText;
  const notes = decision.restatementNotes?.trim() ? decision.restatementNotes : null;
  const fieldId = `restatement-${decision.id}`;

  return (
    <li
      className="px-4 py-3"
      data-testid="restatement-proposal"
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
        <p
          className="mt-0.5 text-xs break-words whitespace-pre-wrap text-muted-foreground"
          data-testid="restatement-original"
        >
          {decision.answer.text}
        </p>
      ) : null}

      <div
        className="mt-2.5 w-full space-y-2 rounded-lg border bg-muted/30 p-3"
        data-testid="restatement-band"
      >
        <p className="flex items-start gap-1.5 text-xs font-medium">
          <IconTextWrap className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
          <span>{t("workspace.restatementProposed")}</span>
        </p>

        {editing ? (
          <div className="space-y-2">
            <Label htmlFor={fieldId} className="sr-only">
              {t("workspace.restatementProposed")}
            </Label>
            <Textarea
              id={fieldId}
              value={draft}
              rows={3}
              autoFocus
              onChange={(event) => setDraft(event.target.value)}
              data-testid="restatement-input"
            />
          </div>
        ) : (
          <p
            className="text-sm break-words whitespace-pre-wrap"
            data-testid="restatement-statement"
          >
            {statement}
          </p>
        )}

        {notes ? (
          <div data-testid="restatement-notes">
            <p className="text-xs font-medium text-muted-foreground">
              {t("workspace.operatorNotesLabel")}
            </p>
            <p className="text-xs break-words whitespace-pre-wrap text-muted-foreground">
              {notes}
            </p>
          </div>
        ) : null}

        {decision.restatementReason ? (
          <p className="text-xs text-muted-foreground">
            {decision.restatementReason}
          </p>
        ) : null}

        <div className="flex flex-wrap justify-end gap-2">
          {editing ? (
            <>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                disabled={busy}
                onClick={() => setEditing(false)}
                data-testid="restatement-cancel"
              >
                {t("workspace.cancel")}
              </Button>
              <Button
                type="button"
                size="sm"
                disabled={busy || draft.trim().length === 0}
                onClick={() =>
                  accept.mutate({ decisionId: decision.id, statement: draft })
                }
                data-testid="restatement-save"
              >
                {accept.isPending && <Spinner className="size-4" />}
                {t("workspace.save")}
              </Button>
            </>
          ) : (
            <>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                disabled={busy}
                onClick={() => dismiss.mutate({ decisionId: decision.id })}
                data-testid="restatement-dismiss"
              >
                {t("workspace.dismissRestatement")}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={() => {
                  setDraft(statement);
                  setEditing(true);
                }}
                data-testid="restatement-edit"
              >
                {t("workspace.editRestatement")}
              </Button>
              <Button
                type="button"
                size="sm"
                disabled={busy}
                onClick={() => accept.mutate({ decisionId: decision.id })}
                data-testid="restatement-accept"
              >
                {accept.isPending && <Spinner className="size-4" />}
                {t("workspace.acceptRestatement")}
              </Button>
            </>
          )}
        </div>
      </div>
    </li>
  );
}

/**
 * Settled own answers the interviewer read as holding more than the decision
 * — a note or instruction to the AI, a note to self, a typo — each with a
 * clean statement pending the owner's agreement. Rendered after the deferral
 * proposals: a pending restatement never blocks confirmation, and accepting
 * one changes the answer's words, not its meaning. Renders nothing while no
 * decision carries one.
 */
export function RestatementProposals({
  decisions,
  onOpenDecision,
}: {
  decisions: readonly TreeDecision[];
  onOpenDecision: (decisionId: string) => void;
}) {
  const t = useT();

  const pending = decisions.filter(
    (decision) => decision.restatementText != null,
  );

  if (pending.length === 0) return null;

  return (
    <section className="space-y-2.5" data-testid="restatement-proposals">
      <h3 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
        {t("workspace.restatementProposalsHeading")}
      </h3>
      <ul className="flex flex-col divide-y divide-border/60">
        {pending.map((decision) => (
          <RestatementProposal
            key={decision.id}
            decision={decision}
            onOpenDecision={onOpenDecision}
          />
        ))}
      </ul>
    </section>
  );
}
