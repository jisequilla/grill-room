import {
  actionErrorMessage,
  useActionMutation,
} from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import { IconAlertCircle, IconCheck, IconPencil } from "@tabler/icons-react";
import { useState } from "react";
import { toast } from "sonner";

import { DecisionStateBadge } from "@/components/workspace/decision-state-badge";
import { Markdown } from "@/components/workspace/markdown";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  ANSWER_KIND_LABEL_KEY,
  type RoundAnswerKind,
  type RoundCard as RoundCardData,
} from "@/lib/decisions";
import { recommendedChoiceIndex } from "@/lib/recommended-choice";
import { cn } from "@/lib/utils";

/** Draft answers that count as given but leave the decision unsettled. */
const LOOSE_END_DRAFT_KINDS: readonly string[] = [
  "unknown",
  "pushed-back",
  "deferred",
  "prototype-flagged",
];

/** The steering moves that need the user to type something before they save. */
type TypedMove = "own-answer" | "pushed-back" | "prototype-flagged";

const MOVE_FIELD: Record<
  TypedMove,
  { labelKey: string; placeholderKey: string; required: boolean }
> = {
  "own-answer": {
    labelKey: "workspace.ownAnswerLabel",
    placeholderKey: "workspace.ownAnswerPlaceholder",
    required: true,
  },
  "pushed-back": {
    labelKey: "workspace.pushBackLabel",
    placeholderKey: "workspace.pushBackPlaceholder",
    required: true,
  },
  "prototype-flagged": {
    labelKey: "workspace.prototypeLabel",
    placeholderKey: "workspace.prototypePlaceholder",
    required: false,
  },
};

/** The four ways to decline to answer, in the order the card offers them. */
const STEERING_MOVES = [
  { kind: "unknown", labelKey: "workspace.unknown", typed: false },
  { kind: "pushed-back", labelKey: "workspace.pushBack", typed: true },
  { kind: "deferred", labelKey: "workspace.defer", typed: false },
  { kind: "prototype-flagged", labelKey: "workspace.prototype", typed: true },
] as const satisfies readonly (
  | { kind: RoundAnswerKind; labelKey: string; typed: false }
  | { kind: TypedMove; labelKey: string; typed: true }
)[];

export function RoundCard({
  card,
  index,
  disabled,
}: {
  card: RoundCardData;
  index: number;
  disabled: boolean;
}) {
  const t = useT();
  const [move, setMove] = useState<TypedMove | null>(null);
  const [text, setText] = useState("");

  const { mutate, isPending } = useActionMutation("save-draft-answer", {
    onSuccess: () => {
      setMove(null);
      setText("");
    },
    onError: (error: unknown) => {
      toast.error(actionErrorMessage(error) ?? t("workspace.draftFailed"));
    },
  });

  const draft = card.draft;
  const busy = disabled || isPending;
  const recommendedIndex = recommendedChoiceIndex(
    card.recommendedAnswer,
    card.choices,
  );
  const leavesOpen =
    draft !== null && LOOSE_END_DRAFT_KINDS.includes(draft.answerKind);

  function save(answerKind: RoundAnswerKind, answer?: string) {
    if (busy) return;
    mutate({ decisionId: card.id, answerKind, answer });
  }

  function openMove(next: TypedMove) {
    setMove(next);
    setText(draft?.answerKind === next ? (draft.answer ?? "") : "");
  }

  const field = move ? MOVE_FIELD[move] : null;
  const canSaveMove = field ? !field.required || text.trim().length > 0 : false;

  return (
    <article
      className={cn(
        "rounded-xl border bg-card transition-colors",
        draft ? "border-border" : "border-foreground/20 shadow-xs",
      )}
      data-testid="round-card"
      data-answered={draft ? "true" : "false"}
    >
      <header className="flex items-start gap-3 px-5 pt-4 pb-3">
        <span className="mt-0.5 font-mono text-xs text-muted-foreground tabular-nums">
          {String(index + 1).padStart(2, "0")}
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="text-[15px] leading-snug font-medium text-balance">
            {card.questionTitle}
          </h3>
          <Markdown
            text={card.questionBody}
            className="mt-1.5 text-sm leading-relaxed text-muted-foreground"
          />
        </div>
        <DecisionStateBadge state={card.state} className="mt-0.5" />
      </header>

      {draft ? (
        // The card counts as answered either way, but a steering move leaves
        // the decision open, and dressing it in the same settled green as a
        // real answer would say it did not.
        <div
          className={cn(
            "mx-5 mb-4 rounded-lg border px-3.5 py-3",
            leavesOpen
              ? "border-orange-600/30 bg-orange-500/[0.08] dark:border-orange-400/30 dark:bg-orange-400/[0.07]"
              : "border-emerald-600/25 bg-emerald-600/[0.07] dark:border-emerald-400/25 dark:bg-emerald-400/[0.07]",
          )}
        >
          <div className="flex items-start gap-3">
            {leavesOpen ? (
              <IconAlertCircle className="mt-0.5 size-4 shrink-0 text-orange-700 dark:text-orange-300" />
            ) : (
              <IconCheck className="mt-0.5 size-4 shrink-0 text-emerald-700 dark:text-emerald-300" />
            )}
            <div className="min-w-0 flex-1">
              <p
                className={cn(
                  "text-[11px] font-medium tracking-wide uppercase",
                  leavesOpen
                    ? "text-orange-800 dark:text-orange-300"
                    : "text-emerald-800 dark:text-emerald-300",
                )}
              >
                {t(ANSWER_KIND_LABEL_KEY[draft.answerKind])}
              </p>
              {draft.answer ? (
                <p className="mt-1 text-sm break-words whitespace-pre-wrap">
                  {draft.answer}
                </p>
              ) : null}
            </div>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="-my-1 shrink-0 border border-border bg-transparent hover:bg-accent"
              disabled={busy}
              onClick={() => openMove("own-answer")}
            >
              {t("workspace.change")}
            </Button>
          </div>
        </div>
      ) : null}

      <div className="space-y-4 px-5 pb-4">
        {/* Pick one, then why the interviewer suggests one of them. The chips
            are the answering mechanism; the prose is the reasoning behind one
            of them, and reading in the other order buries the mechanism. */}
        <div>
          {card.choices.length > 0 ? (
            <p className="pb-2 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
              {t("workspace.chooseOne")}
            </p>
          ) : null}
          <div className="flex flex-wrap items-center gap-2">
            {card.choices.map((choice, choiceIndex) => (
              <Button
                key={choice}
                type="button"
                size="sm"
                variant="outline"
                disabled={busy}
                data-testid="choice-chip"
                data-recommended={
                  choiceIndex === recommendedIndex ? "true" : "false"
                }
                className={cn(
                  "h-9 rounded-full border border-border bg-transparent px-3.5 text-[13px] font-medium",
                  "hover:border-foreground/40 hover:bg-accent",
                  choiceIndex === recommendedIndex &&
                    "border-primary/50 ring-1 ring-primary/40",
                )}
                onClick={() =>
                  // The chip the interviewer recommended is the
                  // recommendation, however differently the two are worded:
                  // recording it as an own answer would lose that it was the
                  // interviewer's own suggestion, which is the one thing a
                  // record of accepting versus diverging is made of.
                  choiceIndex === recommendedIndex
                    ? save("accepted-recommendation")
                    : save("own-answer", choice)
                }
              >
                {choice}
                {choiceIndex === recommendedIndex ? (
                  <span className="rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium tracking-wide text-primary uppercase">
                    {t("workspace.recommended")}
                  </span>
                ) : null}
              </Button>
            ))}

            {/* A fifth way to answer, not a way to decline: it belongs with
                the choices rather than among the steering moves. */}
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={busy}
              className="h-9 rounded-full border border-border bg-transparent px-3.5 text-[13px] font-medium hover:border-foreground/40 hover:bg-accent"
              onClick={() => openMove("own-answer")}
            >
              <IconPencil className="size-3.5" />
              {t("workspace.writeOwn")}
            </Button>
          </div>
        </div>

        {draft ? (
          // Once the decision is settled, the recommendation is context, not
          // the ask: one muted line, and a button that admits it would be
          // replacing an answer that already exists.
          <div
            className="flex items-center gap-3 rounded-lg bg-muted/30 px-3.5 py-2"
            data-testid="recommendation-block"
          >
            <p className="shrink-0 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
              {t("workspace.recommended")}
            </p>
            <p className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
              {card.recommendedAnswer ?? t("workspace.noRecommendation")}
            </p>
            {card.recommendedAnswer ? (
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="shrink-0 border border-border bg-transparent hover:bg-accent"
                disabled={busy}
                onClick={() => save("accepted-recommendation")}
              >
                {t("workspace.acceptInstead")}
              </Button>
            ) : null}
          </div>
        ) : (
          <div
            className="rounded-lg border border-dashed bg-muted/40 px-3.5 py-3"
            data-testid="recommendation-block"
          >
            <div className="flex items-center justify-between gap-3">
              <p className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
                {t("workspace.recommended")}
              </p>
              {card.recommendedAnswer ? (
                <Button
                  type="button"
                  size="sm"
                  disabled={busy}
                  onClick={() => save("accepted-recommendation")}
                >
                  <IconCheck className="size-4" />
                  {t("workspace.accept")}
                </Button>
              ) : null}
            </div>
            {card.recommendedAnswer ? (
              <Markdown
                text={card.recommendedAnswer}
                className="mt-1.5 text-sm text-foreground"
              />
            ) : (
              <p className="mt-1.5 text-sm text-muted-foreground italic">
                {t("workspace.noRecommendation")}
              </p>
            )}
          </div>
        )}

        {field && move ? (
          <div className="space-y-2 rounded-lg border bg-muted/30 p-3.5">
            <Label htmlFor={`answer-${card.id}`} className="text-xs">
              {t(field.labelKey)}
            </Label>
            <Textarea
              id={`answer-${card.id}`}
              value={text}
              rows={3}
              autoFocus
              placeholder={t(field.placeholderKey)}
              onChange={(event) => setText(event.target.value)}
            />
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => setMove(null)}
              >
                {t("workspace.cancel")}
              </Button>
              <Button
                type="button"
                size="sm"
                disabled={busy || !canSaveMove}
                onClick={() => save(move, text.trim())}
              >
                {t("workspace.save")}
              </Button>
            </div>
          </div>
        ) : (
          // Announced rather than left over: two of these commit instantly
          // and change the decision's state, so they are named and sized like
          // the real controls they are. They carry no icons — the one icon on
          // the card belongs to the answer that is not a steering move.
          <div className="border-t pt-3">
            <p className="pb-2 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
              {t("workspace.steerHeading")}
            </p>
            <div className="flex flex-wrap items-center gap-1.5">
              {STEERING_MOVES.map((steer) => (
                <Button
                  key={steer.labelKey}
                  type="button"
                  size="sm"
                  variant="outline"
                  data-testid="steering-move"
                  className="h-8 border border-border bg-transparent px-2.5 text-[13px] font-medium text-foreground/75 hover:border-foreground/40 hover:bg-accent hover:text-foreground"
                  disabled={busy}
                  onClick={() =>
                    steer.typed ? openMove(steer.kind) : save(steer.kind)
                  }
                >
                  {t(steer.labelKey)}
                </Button>
              ))}
            </div>
          </div>
        )}
      </div>
    </article>
  );
}
