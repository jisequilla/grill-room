import {
  actionErrorMessage,
  useActionMutation,
} from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import { IconArrowBackUp } from "@tabler/icons-react";
import { useState, type RefObject } from "react";
import { toast } from "sonner";

import { AnswerNow } from "@/components/workspace/answer-now";
import {
  DecisionStateBadge,
  LooseEndBadge,
} from "@/components/workspace/decision-state-badge";
import { Markdown } from "@/components/workspace/markdown";
import { ReopenDecisionAlert } from "@/components/workspace/reopen-decision-alert";
import { VerdictTag } from "@/components/workspace/review-digest";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { adrSectionView, storedAdrDraft } from "@/lib/adr-section";
import {
  ANSWER_KIND_LABEL_KEY,
  isLooseEnd,
  type TreeDecision,
} from "@/lib/decisions";
import { classifyHistoryEntry } from "@/lib/review-digest";

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-1.5">
      <h4 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
        {title}
      </h4>
      {children}
    </section>
  );
}

/**
 * The ADR flag and Consequences. The draft lives here, so the section mounted
 * inside the sheet and keyed on the decision starts from the stored values
 * each time the sheet opens; a poll that changes the stored values leaves the
 * owner's draft alone.
 */
function AdrSection({ decision }: { decision: TreeDecision }) {
  const t = useT();
  const [draft, setDraft] = useState(() => storedAdrDraft(decision));
  const view = adrSectionView(decision, draft);

  const { mutate, isPending } = useActionMutation("set-adr-worthy", {
    onError: (error: unknown) => {
      toast.error(actionErrorMessage(error) ?? t("workspace.adrSaveFailed"));
    },
  });

  return (
    <Section title={t("workspace.adrSection")}>
      <p className="text-sm text-muted-foreground">
        {t("workspace.adrExplainer")}
      </p>
      {view.editable ? (
        <div className="space-y-2">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              data-testid="adr-worthy-toggle"
              checked={draft.adrWorthy}
              onChange={(event) =>
                setDraft({ ...draft, adrWorthy: event.target.checked })
              }
            />
            {t("workspace.adrWorthy")}
          </label>
          <label className="block space-y-1 text-sm">
            <span className="text-xs font-medium text-muted-foreground">
              {t("workspace.adrConsequences")}
            </span>
            <textarea
              data-testid="adr-consequences"
              className="min-h-20 w-full rounded-md border bg-transparent px-3 py-2 text-sm"
              value={draft.consequences}
              onChange={(event) =>
                setDraft({ ...draft, consequences: event.target.value })
              }
            />
          </label>
          {view.showRequiredHint ? (
            <p
              className="text-xs text-muted-foreground"
              data-testid="adr-consequences-required"
            >
              {t("workspace.adrConsequencesRequired")}
            </p>
          ) : null}
          <Button
            type="button"
            size="sm"
            data-testid="adr-save"
            disabled={!view.saveEnabled || isPending}
            onClick={() => mutate(view.saveInput)}
          >
            {t(isPending ? "workspace.adrSaving" : "workspace.adrSave")}
          </Button>
        </div>
      ) : (
        <div className="space-y-1" data-testid="adr-readonly">
          {decision.adrWorthy ? (
            <>
              <p className="text-sm font-medium">{t("workspace.adrWorthy")}</p>
              {decision.consequences ? (
                <p className="text-sm break-words whitespace-pre-wrap">
                  {decision.consequences}
                </p>
              ) : null}
            </>
          ) : (
            <p className="text-sm">{t("workspace.adrNotMarked")}</p>
          )}
          {view.lockedReasonKey ? (
            <p
              className="text-xs text-muted-foreground"
              data-testid="adr-locked-reason"
            >
              {t(view.lockedReasonKey)}
            </p>
          ) : null}
        </div>
      )}
    </Section>
  );
}

/**
 * One decision, read in full: its question, the answer it holds now, what it
 * hangs off, and the story of what it used to say.
 *
 * The sheet has no Radix trigger, so on close it hands focus back to
 * `returnFocusTo`, the element that opened it. When that element has left the
 * document, Radix's default runs.
 */
export function DecisionDetailSheet({
  decision,
  decisions,
  open,
  onOpenChange,
  returnFocusTo,
}: {
  decision: TreeDecision | null;
  decisions: readonly TreeDecision[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  returnFocusTo: RefObject<HTMLElement | null>;
}) {
  const t = useT();

  if (!decision) return null;

  const byId = new Map(decisions.map((entry) => [entry.id, entry]));
  const dependencies = decision.dependsOn.flatMap((id) => {
    const parent = byId.get(id);
    return parent ? [parent] : [];
  });
  const canReopen = decision.state === "settled" || decision.state === "stale";
  const loose = isLooseEnd(decision);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="flex w-full flex-col gap-0 overflow-y-auto sm:max-w-lg"
        onCloseAutoFocus={(event) => {
          const target = returnFocusTo.current;
          if (!target?.isConnected) return;
          event.preventDefault();
          target.focus();
        }}
      >
        <SheetHeader className="space-y-3 text-left">
          <div className="flex flex-wrap items-center gap-1.5">
            <DecisionStateBadge state={decision.state} />
            {loose ? <LooseEndBadge /> : null}
            {decision.introducedBy === "user" ? (
              <span className="text-xs tracking-wide text-muted-foreground uppercase">
                {t("workspace.addDecision")}
              </span>
            ) : null}
          </div>
          <SheetTitle className="text-base leading-snug text-balance">
            {decision.questionTitle}
          </SheetTitle>
          {decision.questionBody ? (
            <SheetDescription asChild className="leading-relaxed">
              <Markdown text={decision.questionBody} />
            </SheetDescription>
          ) : null}
        </SheetHeader>

        <div className="space-y-5 py-5">
          <Section title={t("workspace.currentAnswer")}>
            {decision.answer ? (
              <div className="rounded-lg border bg-muted/30 px-3 py-2.5">
                <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                  {t(ANSWER_KIND_LABEL_KEY[decision.answer.kind])}
                </p>
                {decision.answer.text ? (
                  <p className="mt-1 text-sm break-words whitespace-pre-wrap">
                    {decision.answer.text}
                  </p>
                ) : null}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground italic">
                {t("workspace.noAnswerYet")}
              </p>
            )}
          </Section>

          <Section title={t("workspace.dependsOn")}>
            {dependencies.length > 0 ? (
              <ul className="space-y-1">
                {dependencies.map((parent) => (
                  <li
                    key={parent.id}
                    className="flex items-start gap-2 text-sm"
                  >
                    <DecisionStateBadge
                      state={parent.state}
                      className="mt-0.5"
                    />
                    <span className="min-w-0 flex-1">
                      {parent.questionTitle}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground italic">
                {t("workspace.dependsOnNothing")}
              </p>
            )}
          </Section>

          <AdrSection key={decision.id} decision={decision} />

          <Separator />

          <Section title={t("workspace.history")}>
            {decision.previousAnswers.length > 0 ? (
              <ol className="space-y-2">
                {decision.previousAnswers.map((entry, index) => (
                  <li
                    key={`${entry.recordedAt}-${index}`}
                    className="rounded-lg border-l-2 border-muted bg-muted/20 py-2 pr-3 pl-3"
                  >
                    {entry.questionTitle !== decision.questionTitle ? (
                      <p className="text-xs text-muted-foreground italic">
                        {t("workspace.historyAskedAs", {
                          title: entry.questionTitle,
                        })}
                      </p>
                    ) : null}
                    <div className="flex flex-wrap items-center gap-1.5">
                      <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                        {entry.kind
                          ? t(ANSWER_KIND_LABEL_KEY[entry.kind])
                          : t("workspace.noAnswerRecorded")}
                      </p>
                      {(() => {
                        const verdict = classifyHistoryEntry(decision, index);
                        return verdict ? <VerdictTag verdict={verdict} /> : null;
                      })()}
                    </div>
                    {entry.text ? (
                      <p className="mt-0.5 text-sm break-words whitespace-pre-wrap">
                        {entry.text}
                      </p>
                    ) : null}
                    {entry.operatorNotes ? (
                      <div className="mt-1.5" data-testid="history-operator-notes">
                        <p className="text-xs font-medium text-muted-foreground">
                          {t("workspace.operatorNotesLabel")}
                        </p>
                        <p className="text-xs break-words whitespace-pre-wrap text-muted-foreground">
                          {entry.operatorNotes}
                        </p>
                      </div>
                    ) : null}
                    {entry.interviewerReason ? (
                      <p className="mt-1.5 text-xs text-muted-foreground">
                        <span className="font-medium">
                          {t("workspace.interviewerReason")}:
                        </span>{" "}
                        {entry.interviewerReason}
                      </p>
                    ) : null}
                  </li>
                ))}
              </ol>
            ) : (
              <p className="text-sm text-muted-foreground italic">
                {t("workspace.noHistory")}
              </p>
            )}
          </Section>
        </div>

        {canReopen || loose ? (
          <div className="mt-auto flex flex-wrap items-center gap-2 border-t pt-4">
            {canReopen ? (
              <ReopenDecisionAlert decision={decision} decisions={decisions}>
                <Button type="button" size="sm" variant="outline">
                  <IconArrowBackUp className="size-4" />
                  {t("workspace.reopen")}
                </Button>
              </ReopenDecisionAlert>
            ) : null}
            {loose ? <AnswerNow decisionId={decision.id} /> : null}
          </div>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}
