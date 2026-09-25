import { useT } from "@agent-native/core/client/i18n";
import { IconArrowBackUp } from "@tabler/icons-react";

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
 * One decision, read in full: its question, the answer it holds now, what it
 * hangs off, and the story of what it used to say.
 */
export function DecisionDetailSheet({
  decision,
  decisions,
  open,
  onOpenChange,
}: {
  decision: TreeDecision | null;
  decisions: readonly TreeDecision[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
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
