import {
  actionErrorMessage,
  useActionMutation,
} from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import {
  IconCheck,
  IconClockPause,
  IconFlask,
  IconHelpCircle,
  IconPencil,
  IconThumbDown,
} from "@tabler/icons-react";
import { useState } from "react";
import { toast } from "sonner";

import { DecisionStateBadge } from "@/components/workspace/decision-state-badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  ANSWER_KIND_LABEL_KEY,
  type RoundAnswerKind,
  type RoundCard as RoundCardData,
} from "@/lib/decisions";
import { cn } from "@/lib/utils";

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
          {card.questionBody ? (
            <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
              {card.questionBody}
            </p>
          ) : null}
        </div>
        <DecisionStateBadge state={card.state} className="mt-0.5" />
      </header>

      {draft ? (
        <div className="mx-5 mb-4 rounded-lg border border-emerald-600/25 bg-emerald-600/[0.07] px-3.5 py-3 dark:border-emerald-400/25 dark:bg-emerald-400/[0.07]">
          <div className="flex items-start gap-3">
            <IconCheck className="mt-0.5 size-4 shrink-0 text-emerald-700 dark:text-emerald-300" />
            <div className="min-w-0 flex-1">
              <p className="text-[11px] font-medium tracking-wide text-emerald-800 uppercase dark:text-emerald-300">
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
              variant="ghost"
              className="-my-1 shrink-0"
              disabled={busy}
              onClick={() => openMove("own-answer")}
            >
              {t("workspace.change")}
            </Button>
          </div>
        </div>
      ) : null}

      <div className="space-y-4 px-5 pb-4">
        <div className="rounded-lg border border-dashed bg-muted/40 px-3.5 py-3">
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
          <p
            className={cn(
              "mt-1.5 text-sm",
              card.recommendedAnswer
                ? "text-foreground"
                : "text-muted-foreground italic",
            )}
          >
            {card.recommendedAnswer ?? t("workspace.noRecommendation")}
          </p>
        </div>

        {card.choices.length > 0 ? (
          <div>
            <p className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
              {t("workspace.choices")}
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              {card.choices.map((choice) => (
                <Button
                  key={choice}
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={busy}
                  className="h-7 rounded-full text-xs font-normal"
                  onClick={() =>
                    // A choice that is the recommendation is the recommendation:
                    // recording it as an own answer would lose that it was the
                    // interviewer's own suggestion.
                    choice === card.recommendedAnswer
                      ? save("accepted-recommendation")
                      : save("own-answer", choice)
                  }
                >
                  {choice}
                </Button>
              ))}
            </div>
          </div>
        ) : null}

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
          <div className="flex flex-wrap items-center gap-1.5 border-t pt-3">
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="h-7 text-xs"
              disabled={busy}
              onClick={() => openMove("own-answer")}
            >
              <IconPencil className="size-3.5" />
              {t("workspace.writeOwn")}
            </Button>
            <span className="mx-1 h-4 w-px bg-border" aria-hidden />
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="h-7 text-xs text-muted-foreground"
              disabled={busy}
              onClick={() => save("unknown")}
            >
              <IconHelpCircle className="size-3.5" />
              {t("workspace.unknown")}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="h-7 text-xs text-muted-foreground"
              disabled={busy}
              onClick={() => openMove("pushed-back")}
            >
              <IconThumbDown className="size-3.5" />
              {t("workspace.pushBack")}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="h-7 text-xs text-muted-foreground"
              disabled={busy}
              onClick={() => save("deferred")}
            >
              <IconClockPause className="size-3.5" />
              {t("workspace.defer")}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="h-7 text-xs text-muted-foreground"
              disabled={busy}
              onClick={() => openMove("prototype-flagged")}
            >
              <IconFlask className="size-3.5" />
              {t("workspace.prototype")}
            </Button>
          </div>
        )}
      </div>
    </article>
  );
}
