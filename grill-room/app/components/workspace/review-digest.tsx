import { useT } from "@agent-native/core/client/i18n";
import { IconChevronRight, IconHistory } from "@tabler/icons-react";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { TurnAttemptLog, type Turn } from "@/components/workspace/turn-attempt-log";
import {
  ANSWER_KIND_LABEL_KEY,
  type DecisionAnswerKind,
  type TreeDecision,
} from "@/lib/decisions";
import {
  reviewCompletedAt,
  reviewEvents,
  roundCardAnchorId,
  visibleReviewEvents,
  type ReviewEvent,
  type ReviewVerdict,
} from "@/lib/review-digest";
import { cn } from "@/lib/utils";

const VERDICT_LABEL_KEY: Record<ReviewVerdict, string> = {
  reconfirm: "workspace.reviewReconfirmed",
  "re-ask": "workspace.reviewReAsked",
};

const VERDICT_CLASS: Record<ReviewVerdict, string> = {
  reconfirm:
    "border-settled/25 bg-settled/10 text-settled",
  "re-ask":
    "border-owed/30 bg-owed/15 text-owed",
};

/** The reconfirm/re-ask tag, shared with the detail sheet and round history so a verdict always reads the same way. */
export function VerdictTag({ verdict }: { verdict: ReviewVerdict }) {
  const t = useT();

  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center rounded-full border px-1.5 py-px text-xs leading-4 font-medium tracking-wide uppercase",
        VERDICT_CLASS[verdict],
      )}
    >
      {t(VERDICT_LABEL_KEY[verdict])}
    </span>
  );
}

function dismissedStorageKey(sessionId: string): string {
  return `grill-room:review-digest:dismissed:${sessionId}`;
}

interface Dismissed {
  id: string;
  /** The dismissed event's own {@link reviewCompletedAt}, not its reopen time. */
  reviewedAt: string;
}

function readDismissed(sessionId: string): Dismissed | null {
  try {
    const raw = window.localStorage.getItem(dismissedStorageKey(sessionId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<Dismissed>;
    if (typeof parsed.id === "string" && typeof parsed.reviewedAt === "string") {
      return { id: parsed.id, reviewedAt: parsed.reviewedAt };
    }
    return null;
  } catch {
    return null;
  }
}

function writeDismissed(sessionId: string, value: Dismissed): void {
  try {
    window.localStorage.setItem(
      dismissedStorageKey(sessionId),
      JSON.stringify(value),
    );
  } catch {
    // Ignore storage access errors; the panel just keeps showing.
  }
}

/**
 * A decision's title, as a link into its open round card when it has one, or
 * into the detail sheet otherwise — the two places a reopened decision or its
 * dependent can actually be read in full.
 */
function DecisionLink({
  decisionId,
  title,
  inOpenRound,
  onOpenDecision,
}: {
  decisionId: string;
  title: string;
  inOpenRound: boolean;
  onOpenDecision: (decisionId: string) => void;
}) {
  const className =
    "rounded-sm text-left text-sm leading-snug font-medium hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none";

  if (inOpenRound) {
    return (
      <a href={`#${roundCardAnchorId(decisionId)}`} className={className}>
        {title}
      </a>
    );
  }

  return (
    <button type="button" onClick={() => onOpenDecision(decisionId)} className={className}>
      {title}
    </button>
  );
}

function AnswerSummary({
  answer,
}: {
  answer: { text: string | null; kind: DecisionAnswerKind | null } | null;
}) {
  const t = useT();

  if (!answer) {
    return <span className="italic">{t("workspace.noAnswerYet")}</span>;
  }

  return (
    <>
      {answer.kind ? t(ANSWER_KIND_LABEL_KEY[answer.kind]) : null}
      {answer.text ? (answer.kind ? ` — ${answer.text}` : answer.text) : null}
    </>
  );
}

function ReviewEventCard({
  event,
  byId,
  openRoundDecisionIds,
  onOpenDecision,
}: {
  event: ReviewEvent;
  byId: ReadonlyMap<string, TreeDecision>;
  openRoundDecisionIds: ReadonlySet<string>;
  onOpenDecision: (decisionId: string) => void;
}) {
  const t = useT();
  const [reconfirmedOpen, setReconfirmedOpen] = useState(false);

  const reopenedTitle = byId.get(event.reopenedId)?.questionTitle ?? event.reopenedId;
  const reAsked = event.reviewed.filter((entry) => entry.verdict === "re-ask");
  const reconfirmed = event.reviewed.filter(
    (entry) => entry.verdict === "reconfirm",
  );

  return (
    <div className="space-y-3 rounded-lg border bg-background/60 px-3.5 py-3">
      <div>
        <DecisionLink
          decisionId={event.reopenedId}
          title={reopenedTitle}
          inOpenRound={openRoundDecisionIds.has(event.reopenedId)}
          onOpenDecision={onOpenDecision}
        />
        <p className="mt-1 text-xs text-muted-foreground">
          <span className="line-through decoration-muted-foreground/50">
            <AnswerSummary answer={event.oldAnswer} />
          </span>
          {" → "}
          <AnswerSummary answer={event.newAnswer} />
        </p>
      </div>

      {reAsked.length > 0 ? (
        <ul className="space-y-2 border-t pt-3">
          {reAsked.map((entry) => (
            <li key={entry.decisionId} className="space-y-0.5">
              <div className="flex flex-wrap items-center gap-1.5">
                <VerdictTag verdict="re-ask" />
                <DecisionLink
                  decisionId={entry.decisionId}
                  title={entry.title}
                  inOpenRound={openRoundDecisionIds.has(entry.decisionId)}
                  onOpenDecision={onOpenDecision}
                />
              </div>
              {entry.retitledTo ? (
                <p className="text-xs text-muted-foreground italic">
                  {t("workspace.reviewNowAskedAs", { title: entry.retitledTo })}
                </p>
              ) : null}
              <p className="text-xs text-muted-foreground">{entry.reason}</p>
            </li>
          ))}
        </ul>
      ) : null}

      {reconfirmed.length > 0 ? (
        <Collapsible
          open={reconfirmedOpen}
          onOpenChange={setReconfirmedOpen}
          className="border-t pt-3"
        >
          <CollapsibleTrigger className="flex items-center gap-1.5 rounded-sm text-xs font-medium text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">
            <IconChevronRight
              className={cn(
                "size-3.5 shrink-0 transition-transform",
                reconfirmedOpen && "rotate-90",
              )}
            />
            {t("workspace.reviewReconfirmedCount", { count: reconfirmed.length })}
          </CollapsibleTrigger>
          <CollapsibleContent className="mt-2 space-y-2 pl-5">
            {reconfirmed.map((entry) => (
              <div key={entry.decisionId} className="space-y-0.5">
                <DecisionLink
                  decisionId={entry.decisionId}
                  title={entry.title}
                  inOpenRound={openRoundDecisionIds.has(entry.decisionId)}
                  onOpenDecision={onOpenDecision}
                />
                <p className="text-xs text-muted-foreground">{entry.reason}</p>
              </div>
            ))}
          </CollapsibleContent>
        </Collapsible>
      ) : null}
    </div>
  );
}

/**
 * What a reopen put in doubt, and how the interviewer ruled on each of its
 * dependents — the summary `docs/design/session-retrospective.md` (finding 4)
 * asked for, since those reasons otherwise live only inside each dependent's
 * own history.
 *
 * Shown once a review event's own verdicts ({@link reviewCompletedAt}, not
 * its reopen) are newer than the last submitted round the user has seen, and
 * stays hidden once dismissed until a newer event arrives: dismissing
 * records the newest visible event's completion time, and only an event
 * after it (or after the next submitted round) shows again.
 */
export function ReviewDigestPanel({
  sessionId,
  decisions,
  lastSubmittedAt,
  openRoundDecisionIds,
  onOpenDecision,
  turn = null,
}: {
  sessionId: string;
  decisions: readonly TreeDecision[];
  /** The most recently submitted round's timestamp, or null when none yet. */
  lastSubmittedAt: string | null;
  /** Decision ids on the currently open round, so a link can jump to the card instead of the sheet. */
  openRoundDecisionIds: ReadonlySet<string>;
  onOpenDecision: (decisionId: string) => void;
  /**
   * The turn of the session's most recent stale review (its
   * `staleReviewTurnId`), collapsed beside the digest it produced. The live
   * attempt log while a review runs is shown in the turn status above this
   * panel instead.
   */
  turn?: Turn | null;
}) {
  const t = useT();
  const [open, setOpen] = useState(true);
  // Read after mount only, so the server-rendered and first client render
  // agree (neither has seen localStorage yet) and the panel never flashes
  // visible before immediately hiding once a past dismissal loads.
  const [ready, setReady] = useState(false);
  const [dismissed, setDismissed] = useState<Dismissed | null>(null);

  useEffect(() => {
    setDismissed(readDismissed(sessionId));
    setReady(true);
  }, [sessionId]);

  if (!ready) return null;

  const events = reviewEvents(decisions);
  const visible = visibleReviewEvents(events, {
    lastSubmittedAt,
    dismissedReviewedAt: dismissed?.reviewedAt ?? null,
  });

  if (visible.length === 0) return null;

  const byId = new Map(decisions.map((decision) => [decision.id, decision]));

  function dismiss() {
    const newest = visible[0];
    if (!newest) return;
    const value = { id: newest.id, reviewedAt: reviewCompletedAt(newest) };
    writeDismissed(sessionId, value);
    setDismissed(value);
  }

  return (
    <Collapsible
      open={open}
      onOpenChange={setOpen}
      className="mb-4 rounded-xl border bg-card/50"
      data-testid="review-digest"
    >
      <div className="flex items-center justify-between gap-2 px-4 py-3">
        <CollapsibleTrigger className="flex min-w-0 flex-1 items-center gap-2 rounded-sm text-left focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">
          <IconHistory className="size-4 shrink-0 text-muted-foreground" />
          <span className="text-sm font-medium">
            {t("workspace.reviewDigestHeading")}
          </span>
          <IconChevronRight
            className={cn(
              "size-4 shrink-0 text-muted-foreground transition-transform",
              open && "rotate-90",
            )}
          />
        </CollapsibleTrigger>
        <Button type="button" size="sm" variant="ghost" onClick={dismiss}>
          {t("workspace.reviewDigestDismiss")}
        </Button>
      </div>
      <CollapsibleContent className="space-y-3 border-t px-4 py-3">
        {visible.map((event) => (
          <ReviewEventCard
            key={event.id}
            event={event}
            byId={byId}
            openRoundDecisionIds={openRoundDecisionIds}
            onOpenDecision={onOpenDecision}
          />
        ))}
        <TurnAttemptLog turn={turn} />
      </CollapsibleContent>
    </Collapsible>
  );
}
