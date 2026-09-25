import { useT } from "@agent-native/core/client/i18n";
import { IconChevronRight, IconRefresh } from "@tabler/icons-react";
import { useState } from "react";

import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Spinner } from "@/components/ui/spinner";
import { useElapsed } from "@/lib/use-elapsed";
import { cn } from "@/lib/utils";

import type { AttemptKind } from "@shared/session-constants";

type TurnResult = AgentNativeActionRegistry["get-turn"]["result"];

/**
 * A turn record with its runs and attempts, as `get-turn` and `get-latest-turn`
 * both return it. The one shape every attempt log reads, whichever turn kind
 * or surface it is shown on.
 */
export type Turn = TurnResult;
type Run = Turn["runs"][number];
type Attempt = Run["attempts"][number];

/**
 * The rejection budget every run enforces: one attempt, then two retries.
 * Mirrors `MAX_TURN_RETRIES` in `server/turn.ts`, server-only code this client
 * bundle cannot import.
 */
const RUN_BUDGET = 3;

const KIND_LABEL_KEY: Record<AttemptKind, string> = {
  "tree-rule-refusal": "workspace.attemptKindTreeRuleRefusal",
  "schema-invalid": "workspace.attemptKindSchemaInvalid",
  "resume-fallback": "workspace.attemptKindResumeFallback",
  "rate-limit": "workspace.attemptKindRateLimit",
  error: "workspace.attemptKindError",
  success: "workspace.attemptKindSuccess",
};

/**
 * A rate limit and a tree-rule refusal are owed, not destructive: the first is
 * the shared subscription running out, not a defect, and the log must never
 * read like one. A schema-invalid answer and a plain error share destructive;
 * their label, not their colour, tells them apart.
 */
const KIND_CLASS: Record<AttemptKind, string> = {
  "tree-rule-refusal":
    "border-owed/30 bg-owed/15 text-owed",
  "schema-invalid":
    "border-destructive/30 bg-destructive/10 text-destructive",
  "resume-fallback": "border-border bg-muted text-muted-foreground",
  "rate-limit":
    "border-owed/30 bg-owed/15 text-owed",
  error: "border-destructive/30 bg-destructive/10 text-destructive",
  success:
    "border-settled/25 bg-settled/10 text-settled",
};

/** The pill every kind tag shares, `KindTag`'s own and the interrupted placeholder's alike. */
const TAG_BASE_CLASS =
  "inline-flex shrink-0 items-center rounded-full border px-1.5 py-px text-xs leading-4 font-medium tracking-wide uppercase";

function KindTag({ kind }: { kind: AttemptKind }) {
  const t = useT();

  return (
    <span
      className={cn(TAG_BASE_CLASS, KIND_CLASS[kind])}
      data-testid="attempt-kind"
      data-kind={kind}
    >
      {t(KIND_LABEL_KEY[kind])}
    </span>
  );
}

/**
 * What a `kind: null` attempt renders as once its turn has already stopped:
 * the model call was still running when something else ended the turn — the
 * server restarting mid-call, say — so its outcome was never recorded and
 * never will be. Styled neutrally, like a resume fallback: it is missing
 * evidence, not a failure of its own.
 */
function InterruptedTag() {
  const t = useT();

  return (
    <span
      className={cn(TAG_BASE_CLASS, "border-border bg-muted text-muted-foreground")}
      data-testid="attempt-kind"
      data-kind="interrupted"
    >
      {t("workspace.attemptInterrupted")}
    </span>
  );
}

/** `72400` -> `1:12`, the same `m:ss` shape `useElapsed` renders live. */
function formatDuration(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

function LiveDuration({ startedAt }: { startedAt: string }) {
  const elapsed = useElapsed(startedAt);
  return <>{elapsed}</>;
}

/**
 * Each attempt's number out of the run's rejection budget, or null for a
 * resume fallback, which never spends it. Counts a still-running attempt too
 * (its kind reads `null` until the call ends) — it is presumed to count until
 * it proves otherwise, the same number the run will read back once it
 * completes.
 */
function budgetNumbers(attempts: readonly Attempt[]): (number | null)[] {
  let count = 0;
  return attempts.map((attempt) => {
    if (attempt.kind === "resume-fallback") return null;
    count += 1;
    return count;
  });
}

/**
 * Exported only so a test can render one row directly: once a turn has
 * completed, `TurnAttemptLog` collapses it by default, and this project's
 * tests render statically with no way to simulate the click that expands
 * it — so the running-vs-interrupted distinction below is tested against
 * this component, not the collapsed parent.
 */
export function AttemptRow({
  attempt,
  budgetNumber,
  turnCompleted,
}: {
  attempt: Attempt;
  budgetNumber: number | null;
  /**
   * Whether the turn this attempt belongs to has already stopped. A `kind:
   * null` attempt reads as still running only while its turn has not — once
   * the turn has completed, `kind: null` can only mean the call was
   * interrupted and never will report an outcome.
   */
  turnCompleted: boolean;
}) {
  const t = useT();
  const { kind } = attempt;
  const interrupted = kind === null && turnCompleted;
  const running = kind === null && !turnCompleted;

  return (
    <li
      className="flex items-start justify-between gap-3 py-1.5"
      data-testid="attempt-row"
      data-attempt-kind={kind ?? (turnCompleted ? "interrupted" : "running")}
      data-budget-number={budgetNumber ?? undefined}
    >
      <div className="flex min-w-0 flex-col gap-0.5">
        <div className="flex flex-wrap items-center gap-1.5">
          {running ? (
            <span className="inline-flex items-center gap-1 text-xs font-medium tracking-wide text-muted-foreground uppercase">
              <Spinner className="size-3" />
              {t("workspace.attemptRunning")}
            </span>
          ) : interrupted ? (
            <InterruptedTag />
          ) : (
            <KindTag kind={kind as AttemptKind} />
          )}
          {budgetNumber != null ? (
            <span className="text-xs text-muted-foreground">
              {t("workspace.attemptNumber", {
                number: budgetNumber,
                budget: RUN_BUDGET,
              })}
            </span>
          ) : null}
        </div>
        {attempt.reason ? (
          <p className="text-xs text-muted-foreground">{attempt.reason}</p>
        ) : null}
      </div>
      <span
        className="shrink-0 font-mono text-xs tabular-nums text-muted-foreground"
        data-testid="attempt-duration"
      >
        {running ? (
          <LiveDuration startedAt={attempt.startedAt} />
        ) : interrupted ? (
          "—"
        ) : (
          formatDuration(attempt.durationMs ?? 0)
        )}
      </span>
    </li>
  );
}

function RunSection({
  run,
  showSeparator,
  turnCompleted,
}: {
  run: Run;
  showSeparator: boolean;
  turnCompleted: boolean;
}) {
  const t = useT();
  const numbers = budgetNumbers(run.attempts);

  return (
    <>
      {showSeparator ? (
        <div
          className="flex items-center gap-2 py-1"
          data-testid="manual-retry-separator"
        >
          <div className="h-px flex-1 bg-border" />
          <span className="flex items-center gap-1 text-xs font-medium tracking-wide text-muted-foreground uppercase">
            <IconRefresh className="size-3" />
            {t("workspace.attemptManualRetry")}
          </span>
          <div className="h-px flex-1 bg-border" />
        </div>
      ) : null}
      <ul className="flex flex-col divide-y divide-border/60">
        {run.attempts.map((attempt, index) => (
          <AttemptRow
            key={attempt.id}
            attempt={attempt}
            budgetNumber={numbers[index] ?? null}
            turnCompleted={turnCompleted}
          />
        ))}
      </ul>
    </>
  );
}

/**
 * Every attempt a turn made, the one component used wherever a turn is shown
 * — the live turn status and, collapsed, next to whatever the turn produced.
 *
 * While the turn is still running (`completedAt` is null) it renders open,
 * plainly, with no collapse control. Once it stops it renders collapsed to a
 * one-line count, expandable to read every run back. Runs after the first are
 * preceded by a "manual retry" separator. Raw output is never shown here.
 *
 * `turn` is null for a result from before turn records existed, or while no
 * turn is running yet — either way this renders nothing.
 */
export function TurnAttemptLog({ turn }: { turn: Turn | null }) {
  const t = useT();
  const running = turn != null && turn.completedAt === null;
  const [open, setOpen] = useState(running);

  if (!turn) return null;

  const totalAttempts = turn.runs.reduce(
    (sum, run) => sum + run.attempts.length,
    0,
  );
  if (totalAttempts === 0) return null;

  const body = (
    <div className="flex flex-col gap-1 pt-1" data-testid="attempt-log-body">
      {turn.runs.map((run, index) => (
        <RunSection
          key={run.id}
          run={run}
          showSeparator={index > 0}
          turnCompleted={!running}
        />
      ))}
    </div>
  );

  if (running) {
    return (
      <div className="mt-3 w-full text-left" data-testid="attempt-log">
        {body}
      </div>
    );
  }

  return (
    <div className="mt-3 w-full text-left" data-testid="attempt-log">
      <Collapsible open={open} onOpenChange={setOpen}>
        <CollapsibleTrigger
          className="flex items-center gap-1.5 rounded-md px-1 py-1 text-xs text-muted-foreground hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          data-testid="attempt-log-trigger"
          data-count={totalAttempts}
        >
          <IconChevronRight
            className="size-3.5 shrink-0 transition-transform data-[open=true]:rotate-90"
            data-open={open}
          />
          {t("workspace.attemptLogCount", { count: totalAttempts })}
        </CollapsibleTrigger>
        <CollapsibleContent>{body}</CollapsibleContent>
      </Collapsible>
    </div>
  );
}
