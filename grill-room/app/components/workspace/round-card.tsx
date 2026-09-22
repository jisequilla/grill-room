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
import { resolveRecommendedChoice } from "@/lib/recommended-choice";
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

function isTypedMove(kind: string): kind is TypedMove {
  return kind in MOVE_FIELD;
}

/**
 * The question, as a button only where there is something to unfold: a
 * heading that does nothing should not be announced as a control.
 */
function Question({
  as,
  expanded,
  onToggle,
  children,
}: {
  as: "button" | "div";
  expanded: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  if (as === "div") return <div className="min-w-0 flex-1">{children}</div>;

  return (
    <button
      type="button"
      aria-expanded={expanded}
      onClick={onToggle}
      className="min-w-0 flex-1 rounded-sm text-left focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
    >
      {children}
    </button>
  );
}

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
  foldable,
  expanded,
  onExpandedChange,
}: {
  card: RoundCardData;
  index: number;
  disabled: boolean;
  /** Whether the round holds more than one card, so an answered one can fold. */
  foldable: boolean;
  /** Whether this is the card the user is working on, which never folds. */
  expanded: boolean;
  onExpandedChange: (expanded: boolean) => void;
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
  const canFold = foldable && draft !== null;
  const folded = canFold && !expanded;
  const recommendedIndex = resolveRecommendedChoice(card);
  // Which chip the draft stands for, so the card shows what was picked rather
  // than only that something was. An accepted recommendation is the marked
  // chip; an own answer is a chip only when its text is one of the labels,
  // which is what clicking a chip writes.
  const selectedIndex =
    draft === null
      ? null
      : draft.answerKind === "accepted-recommendation"
        ? recommendedIndex
        : draft.answerKind === "own-answer"
          ? (card.choices.findIndex(
              (choice) => choice.label === draft.answer,
            ) ?? -1)
          : -1;
  const leavesOpen =
    draft !== null && LOOSE_END_DRAFT_KINDS.includes(draft.answerKind);

  function save(answerKind: RoundAnswerKind, answer?: string) {
    if (busy) return;
    onExpandedChange(true);
    mutate({ decisionId: card.id, answerKind, answer });
  }

  function openMove(next: TypedMove) {
    onExpandedChange(true);
    setMove(next);
    setText(draft?.answerKind === next ? (draft.answer ?? "") : "");
  }

  /**
   * `Change` returns to the mode the draft was made in. A typed move reopens
   * its own field with what was typed; an accepted recommendation, an
   * `I don't know` or a deferral were made from the rows below, so it returns
   * to those rather than to a blank textarea that would mean "replace this
   * with something typed".
   */
  function change() {
    if (draft !== null && isTypedMove(draft.answerKind)) {
      openMove(draft.answerKind);
      return;
    }
    onExpandedChange(true);
    setMove(null);
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
      data-folded={folded ? "true" : "false"}
    >
      <header className="flex items-start gap-3 px-5 pt-4 pb-3">
        <span className="mt-0.5 font-mono text-xs text-muted-foreground tabular-nums">
          {String(index + 1).padStart(2, "0")}
        </span>
        {/* An answered card in a multi-card round folds to its question and
            its answer, and the header is what unfolds it again. */}
        <Question
          as={canFold ? "button" : "div"}
          expanded={!folded}
          onToggle={() => onExpandedChange(folded)}
        >
          <h3 className="text-[15px] leading-snug font-medium text-balance">
            {card.questionTitle}
          </h3>
          {folded ? null : (
            <Markdown
              text={card.questionBody}
              className="mt-1.5 text-sm leading-relaxed text-muted-foreground"
            />
          )}
        </Question>
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
                <p
                  className={cn(
                    "mt-1 text-sm break-words whitespace-pre-wrap",
                    folded && "line-clamp-2",
                  )}
                >
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
              onClick={change}
            >
              {t("workspace.change")}
            </Button>
          </div>
        </div>
      ) : null}

      {folded ? null : (
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
            {/* One row per choice, its own case under its label. A row rather
              than a chip because the rationale is the point: a label alone is
              not a choice the user can judge against a reasoned
              recommendation. Two tight lines each keeps five of them to about
              a third of the card. */}
            <div className="grid gap-2">
              {card.choices.map((choice, choiceIndex) => {
                const recommended = choiceIndex === recommendedIndex;
                const selected = choiceIndex === selectedIndex;
                return (
                  <button
                    key={choice.label}
                    type="button"
                    aria-pressed={selected}
                    disabled={busy}
                    data-testid="choice-chip"
                    data-recommended={recommended ? "true" : "false"}
                    data-selected={selected ? "true" : "false"}
                    className={cn(
                      "min-h-9 w-full rounded-lg border border-border bg-transparent px-3.5 py-2.5 text-left transition-colors",
                      "hover:border-foreground/40 hover:bg-accent",
                      "focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
                      "disabled:pointer-events-none disabled:opacity-60",
                      recommended && "border-primary/50",
                      selected && "border-foreground bg-accent",
                    )}
                    onClick={() =>
                      // The chip the interviewer recommended is the
                      // recommendation, however differently the two are
                      // worded: recording it as an own answer would lose that
                      // it was the interviewer's own suggestion, which is the
                      // one thing a record of accepting versus diverging is
                      // made of.
                      recommended
                        ? save("accepted-recommendation")
                        : save("own-answer", choice.label)
                    }
                  >
                    <span className="flex items-center gap-2">
                      {selected ? (
                        <IconCheck className="size-3.5 shrink-0" />
                      ) : null}
                      <span className="min-w-0 text-[13px] font-medium">
                        {choice.label}
                      </span>
                      {recommended ? (
                        <span className="shrink-0 rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium tracking-wide text-primary uppercase">
                          {t("workspace.recommended")}
                        </span>
                      ) : null}
                    </span>
                    {choice.rationale ? (
                      <span className="mt-1 block text-xs leading-relaxed text-muted-foreground">
                        {choice.rationale}
                      </span>
                    ) : null}
                  </button>
                );
              })}
            </div>

            {/* A fifth way to answer, not a way to decline: it belongs with
              the choices rather than among the steering moves. */}
            <div
              className={cn(
                "flex flex-wrap items-center gap-2",
                card.choices.length > 0 && "pt-2",
              )}
            >
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
      )}
    </article>
  );
}
