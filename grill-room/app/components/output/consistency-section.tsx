import {
  actionErrorMessage,
  useActionMutation,
  useActionQuery,
} from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import { IconAlertTriangle, IconChecks, IconRefresh } from "@tabler/icons-react";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { toast } from "sonner";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";

export type ConsistencyList = AgentNativeActionRegistry["list-consistency-findings"]["result"];
export type ConsistencyCard = ConsistencyList["findings"][number];
type Place = ConsistencyCard["at"];

/** A check is one turn of its own, and a turn can take several minutes. */
const TURN_TIMEOUT_MS = 10 * 60 * 1000;

const KIND_LABEL_KEY: Record<string, string> = {
  "unquantified-threshold": "output.consistencyKindUnquantifiedThreshold",
  "one-case-rule": "output.consistencyKindOneCaseRule",
  "spec-ticket-contradiction": "output.consistencyKindSpecTicketContradiction",
  "open-choice": "output.consistencyKindOpenChoice",
  "undefaulted-value": "output.consistencyKindUndefaultedValue",
  "unnamed-target": "output.consistencyKindUnnamedTarget",
};

/** The ids to ask: every checked open card, in number order. */
export function askedFindingIds(
  cards: readonly ConsistencyCard[],
  checked: ReadonlySet<string>,
): string[] {
  return cards
    .filter((card) => card.status === "open" && checked.has(card.id))
    .sort((a, b) => a.number - b.number)
    .map((card) => card.id);
}

function PlaceQuote({ place }: { place: Place }) {
  const t = useT();
  return (
    <div className="min-w-0 space-y-0.5">
      <p className="text-xs text-muted-foreground">
        {place.artefact === "spec"
          ? t("output.consistencyPlaceSpec", { section: place.section ?? "" })
          : t("output.consistencyPlaceTicket", { ticket: place.ticket ?? "" })}
      </p>
      <blockquote className="border-l-2 pl-3 text-sm break-words text-foreground/80">
        {place.quote}
      </blockquote>
    </div>
  );
}

/** What became of an asked card's decision, in one line. */
function decisionLine(card: ConsistencyCard, t: ReturnType<typeof useT>): string {
  const decision = card.decision;
  if (decision === null) return t("output.consistencyDecisionGone");
  if (decision.state === "withdrawn") return t("output.consistencyDecisionWithdrawn");
  if (decision.state === "settled") {
    return t("output.consistencyDecisionAnswered", { answer: decision.answer ?? "" });
  }
  return t("output.consistencyDecisionWaiting");
}

function CardItem({
  card,
  actionable,
  working,
  dismissing,
  onAnswer,
  onDismiss,
}: {
  card: ConsistencyCard;
  actionable: boolean;
  working: boolean;
  dismissing: boolean;
  onAnswer: (card: ConsistencyCard) => void;
  onDismiss: (card: ConsistencyCard) => void;
}) {
  const t = useT();
  const places = card.against ? [card.at, card.against] : [card.at];

  return (
    <li
      className={cn(
        "space-y-3 rounded-xl border px-4 py-3",
        card.status === "dismissed" && "bg-muted/40 text-muted-foreground",
      )}
      data-testid={`consistency-card-${card.number}`}
      data-status={card.status}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-xs text-muted-foreground">
          {t("output.consistencyCardNumber", { number: card.number })}
        </span>
        <Badge variant="outline" className="font-normal">
          {t(KIND_LABEL_KEY[card.kind] ?? card.kind)}
        </Badge>
        {card.status === "dismissed" ? (
          <Badge variant="secondary">{t("output.consistencyDismissed")}</Badge>
        ) : null}
        {card.status === "asked" ? (
          <Badge variant="default">{t("output.consistencyAsked")}</Badge>
        ) : null}
      </div>

      <p
        className={cn(
          "text-sm leading-snug font-medium break-words",
          card.status === "dismissed" && "font-normal",
        )}
      >
        {card.question}
      </p>

      <div className="space-y-2">
        {places.map((place, index) => (
          <PlaceQuote key={index} place={place} />
        ))}
      </div>

      {card.decisionKey ? (
        <p className="text-xs text-muted-foreground">
          {t("output.consistencyFromDecision", { key: card.decisionKey })}
        </p>
      ) : null}

      {card.status === "asked" ? (
        <p
          className="text-sm break-words"
          data-testid={`consistency-decision-${card.number}`}
        >
          {decisionLine(card, t)}
        </p>
      ) : null}

      {card.status === "open" && actionable ? (
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            size="sm"
            disabled={working}
            onClick={() => onAnswer(card)}
            data-testid={`consistency-answer-${card.number}`}
          >
            {t("output.consistencyAnswer")}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={working || dismissing}
            onClick={() => onDismiss(card)}
            data-testid={`consistency-dismiss-${card.number}`}
          >
            {t("output.consistencyDismiss")}
          </Button>
        </div>
      ) : null}
    </li>
  );
}

/**
 * The consistency check's reopen cards, as the output page shows them: pure,
 * so every state renders from fixture data. `ConsistencySection` feeds it.
 */
export function ConsistencyCardsView({
  list,
  hasTickets,
  working,
  checking = false,
  dismissingId = null,
  onAnswer = () => {},
  onDismiss = () => {},
  onCheckAgain = () => {},
}: {
  list: ConsistencyList;
  hasTickets: boolean;
  working: boolean;
  checking?: boolean;
  dismissingId?: string | null;
  onAnswer?: (card: ConsistencyCard) => void;
  onDismiss?: (card: ConsistencyCard) => void;
  onCheckAgain?: () => void;
}) {
  const t = useT();
  if (!hasTickets) return null;

  const busy = working || checking;
  const cards = list.findings;
  const checkAgain = (
    <Button
      type="button"
      variant="outline"
      size="sm"
      disabled={busy}
      onClick={onCheckAgain}
      data-testid="consistency-check-again"
    >
      {checking ? <Spinner className="size-4" /> : <IconRefresh className="size-4" />}
      {t(checking ? "output.consistencyChecking" : "output.consistencyCheckAgain")}
    </Button>
  );

  return (
    <section className="space-y-3" data-testid="consistency-section">
      <div className="space-y-1">
        <h2 className="text-sm font-medium">{t("output.consistencyHeading")}</h2>
        <p className="text-sm text-muted-foreground">{t("output.consistencyHint")}</p>
      </div>

      {list.note ? (
        <Alert data-testid="consistency-note" data-error-code={list.note.code}>
          <IconAlertTriangle className="size-4" />
          <AlertTitle>{t("output.consistencyNoteTitle")}</AlertTitle>
          <AlertDescription className="space-y-3">
            <p className="break-words">{list.note.message}</p>
            {list.note.code !== "too-many-tickets" ? checkAgain : null}
          </AlertDescription>
        </Alert>
      ) : null}

      {!list.checked && !list.note ? (
        <div
          className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-dashed px-4 py-3"
          data-testid="consistency-unchecked"
        >
          <p className="text-sm text-muted-foreground">{t("output.consistencyUnchecked")}</p>
          {checkAgain}
        </div>
      ) : null}

      {list.checked && list.current && cards.length === 0 ? (
        <div
          className="flex items-center gap-2.5 rounded-xl border border-dashed px-4 py-3 text-sm text-muted-foreground"
          data-testid="consistency-none"
        >
          <IconChecks className="size-4 shrink-0" />
          {t("output.consistencyNone")}
        </div>
      ) : null}

      {cards.length > 0 && !list.current ? (
        <p className="text-sm text-owed" data-testid="consistency-outdated">
          {t("output.consistencyOutdated")}
        </p>
      ) : null}

      {cards.length > 0 ? (
        <ul className="space-y-3">
          {cards.map((card) => (
            <CardItem
              key={card.id}
              card={card}
              actionable={list.askable}
              working={busy}
              dismissing={dismissingId === card.id}
              onAnswer={onAnswer}
              onDismiss={onDismiss}
            />
          ))}
        </ul>
      ) : null}
    </section>
  );
}

/**
 * The body of the ask dialog: every open card as a checkbox. Pure, like the
 * view above; the dialog wraps it.
 */
export function ConsistencyAskOptions({
  cards,
  checked,
  onToggle,
}: {
  cards: readonly ConsistencyCard[];
  checked: ReadonlySet<string>;
  onToggle: (id: string, on: boolean) => void;
}) {
  return (
    <ul className="max-h-80 space-y-2 overflow-y-auto">
      {cards
        .filter((card) => card.status === "open")
        .map((card) => {
          const id = `consistency-ask-option-${card.number}`;
          return (
            <li key={card.id} className="flex items-start gap-3 rounded-lg border px-3 py-2">
              <Checkbox
                id={id}
                className="mt-0.5"
                checked={checked.has(card.id)}
                onCheckedChange={(value) => onToggle(card.id, value === true)}
                data-testid={id}
              />
              <label htmlFor={id} className="min-w-0 text-sm leading-snug break-words">
                {card.question}
              </label>
            </li>
          );
        })}
    </ul>
  );
}

export function ConsistencySection({
  sessionId,
  working,
  onSettled,
}: {
  sessionId: string;
  working: boolean;
  onSettled: () => void;
}) {
  const t = useT();
  const navigate = useNavigate();
  const [asking, setAsking] = useState<ConsistencyCard | null>(null);
  const [checked, setChecked] = useState<Set<string>>(new Set());

  const { data: ticketsData } = useActionQuery("list-tickets", { sessionId });
  const hasTickets = (ticketsData?.tickets.length ?? 0) > 0;
  const { data: list } = useActionQuery(
    "list-consistency-findings",
    { sessionId },
    { enabled: hasTickets },
  );

  useEffect(() => {
    if (asking) setChecked(new Set([asking.id]));
  }, [asking]);

  const dismiss = useActionMutation("dismiss-consistency-finding", {
    onError: (error: unknown) =>
      toast.error(actionErrorMessage(error) ?? t("output.consistencyDismissFailed")),
    onSettled,
  });

  const check = useActionMutation("check-consistency", {
    timeoutMs: TURN_TIMEOUT_MS,
    onError: (error: unknown) =>
      toast.error(actionErrorMessage(error) ?? t("output.consistencyCheckFailed")),
    onSettled,
  });

  const ask = useActionMutation("ask-consistency-findings", {
    onSuccess: () => {
      setAsking(null);
      navigate(`/sessions/${sessionId}`);
    },
    onError: (error: unknown) =>
      toast.error(actionErrorMessage(error) ?? t("output.consistencyAskFailed")),
    onSettled,
  });

  if (!list) return null;

  const findingIds = askedFindingIds(list.findings, checked);

  return (
    <>
      <ConsistencyCardsView
        list={list}
        hasTickets={hasTickets}
        working={working}
        checking={check.isPending}
        dismissingId={dismiss.isPending ? (dismiss.variables?.findingId ?? null) : null}
        onAnswer={setAsking}
        onDismiss={(card) => dismiss.mutate({ findingId: card.id })}
        onCheckAgain={() => check.mutate({ sessionId })}
      />

      <Dialog open={asking !== null} onOpenChange={(open) => (open ? null : setAsking(null))}>
        <DialogContent className="sm:max-w-xl" data-testid="consistency-ask-dialog">
          <DialogHeader>
            <DialogTitle>{t("output.consistencyAskTitle")}</DialogTitle>
            <DialogDescription>{t("output.consistencyAskDescription")}</DialogDescription>
          </DialogHeader>
          <ConsistencyAskOptions
            cards={list.findings}
            checked={checked}
            onToggle={(id, on) =>
              setChecked((current) => {
                const next = new Set(current);
                if (on) next.add(id);
                else next.delete(id);
                return next;
              })
            }
          />
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setAsking(null)}>
              {t("workspace.cancel")}
            </Button>
            <Button
              type="button"
              disabled={findingIds.length === 0 || ask.isPending || working}
              onClick={() => ask.mutate({ findingIds })}
              data-testid="consistency-ask-confirm"
            >
              {ask.isPending && <Spinner className="size-4" />}
              {ask.isPending
                ? t("output.consistencyAsking")
                : t("output.consistencyAskConfirm", { count: findingIds.length })}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
