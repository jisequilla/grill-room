import { useT } from "@agent-native/core/client/i18n";
import { IconChevronRight } from "@tabler/icons-react";
import { useEffect, useRef, useState } from "react";

import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import type { Readiness, ScoutReport } from "@/components/workspace/readiness-panel";

type Translate = (key: string, options?: Record<string, unknown>) => string;

/** What {@link briefSummary} needs to compose the strip's one summary line. */
export interface BriefSummaryInput {
  hasProject: boolean;
  scoutReport: ScoutReport | null;
  /** A scout-project turn is running right now — this tab's own request, or
   * another tab's, seen through polling. */
  scoutWorking: boolean;
  readiness: Readiness | null;
  /** An assess-readiness turn is running right now, the same way. */
  readinessWorking: boolean;
}

/**
 * The scout half of the summary: `Scout: read <commit>` (or `Scout: read ·
 * no commits yet`), then the keep/drop/review counts. Every proposed
 * decision the scout ever raised carries a disposition (defaulting to
 * "undecided" — see `server/scout-report.ts`'s `storeScoutReport`), so
 * counting them by disposition value accounts for the whole report.
 */
function scoutReportSummary(report: ScoutReport, t: Translate): string {
  const commitPart = report.commitRead
    ? t("workspace.briefScoutReadCommit", { commit: report.commitRead.slice(0, 7) })
    : t("workspace.briefScoutNoCommit");

  const dispositions = Object.values(report.dispositions);
  const kept = dispositions.filter((disposition) => disposition === "kept").length;
  const dropped = dispositions.filter((disposition) => disposition === "dropped").length;
  const toReview = dispositions.filter((disposition) => disposition === "undecided").length;

  const counts = t("workspace.briefScoutCounts", { kept, dropped });
  const review =
    toReview > 0 ? t("workspace.briefScoutToReview", { count: toReview }) : "";

  return `${commitPart} · ${counts}${review}`;
}

/**
 * The scout half of the summary line, or `null` with no project — the
 * segment the summary drops entirely rather than rendering empty. Rendered
 * separately from {@link briefReadinessPart} so the two can carry different
 * truncation rules (the scout half truncates at narrow widths; the verdict
 * never does — see `BriefStrip`'s render).
 */
export function briefScoutPart(input: BriefSummaryInput, t: Translate): string | null {
  if (!input.hasProject) return null;
  return input.scoutWorking
    ? t("workspace.briefScoutReading")
    : input.scoutReport
      ? scoutReportSummary(input.scoutReport, t)
      : t("workspace.briefScoutNotRun");
}

/** The readiness half of the summary line: always present, "Ready" / "Not
 * ready" / "Readiness · not judged" / "Readiness · judging…". */
export function briefReadinessPart(input: BriefSummaryInput, t: Translate): string {
  return input.readinessWorking
    ? t("workspace.briefReadinessJudging")
    : input.readiness
      ? t(
          input.readiness.result.verdict === "ready"
            ? "sessions.readinessReady"
            : "sessions.readinessNotReady",
        )
      : t("workspace.briefReadinessNotJudged");
}

/**
 * DESIGN.md's Brief strip summary line, e.g. "Scout: read 0c00712 · 2 kept, 6
 * dropped · Ready" (Composition, "Session workspace (the bench)"). A pure
 * function of the same data the route already fetches — `scoutReport` and
 * `round.readiness` — so a unit test can pin its exact text without
 * rendering the strip. Composes {@link briefScoutPart} and {@link
 * briefReadinessPart}; `BriefStrip` renders those two separately (for
 * per-half truncation) but uses this combined string for the summary's
 * `title`/`aria-label`, so the full text is still available to anyone who
 * hovers or uses assistive tech, whatever the viewport truncates away.
 *
 * With no project, the scout half never applies: the summary is the
 * readiness half alone (row 5 of the ticket's behaviour table).
 */
export function briefSummary(input: BriefSummaryInput, t: Translate): string {
  const readinessPart = briefReadinessPart(input, t);
  const scoutPart = briefScoutPart(input, t);
  if (scoutPart === null) return readinessPart;
  return t("workspace.briefSummary", { scout: scoutPart, readiness: readinessPart });
}

/**
 * The strip's open/closed decision for one `list-rounds` resolution — the
 * pure core of `BriefStrip`'s effect, exported so its three cases (initial
 * expand/collapse, the live collapse on the first round opening, and a
 * later round never re-collapsing) can each be pinned with a plain unit
 * test, without mounting a component (`renderToStaticMarkup` never runs
 * effects, so the effect itself cannot be exercised that way).
 */
export function nextBriefStripOpenState(input: {
  /** The round count the last resolved `list-rounds` read confirmed, or
   * `null` before that has happened even once. */
  previousConfirmedCount: number | null;
  /** The round count `list-rounds` just resolved to. */
  roundsCount: number;
  /** The strip's current open state, kept unless this transition forces a
   * change. */
  currentOpen: boolean;
}): boolean {
  if (input.previousConfirmedCount === null) return input.roundsCount === 0;
  if (input.previousConfirmedCount === 0 && input.roundsCount > 0) return false;
  return input.currentOpen;
}

/**
 * The bench's one-line Brief strip: folds the project scout report and the
 * readiness judgment above the current ask. `ScoutReportPanel` and
 * `ReadinessPanel` are unchanged; the route passes them in as `children`,
 * exactly as it rendered them before — only where they render moved.
 *
 * **Whether the strip renders at all** is a project, a stored readiness
 * judgment, or — to keep the readiness invitation reachable before the first
 * round exactly as it is today, with no project and no judgment yet —
 * `showReadiness` (the route's existing "no rounds yet, still interviewing"
 * flag). That last clause is what keeps `e2e/readiness.spec.ts` passing
 * unchanged: a fresh, project-less session must still show the readiness
 * panel before it has ever been assessed, which only `showReadiness` knows.
 * The route mirrors this same condition when it decides whether to pass a
 * `ReadinessPanel` as a child, so the strip's body is never left empty by a
 * gate that let the strip itself through.
 *
 * **Whether it starts open** follows `roundsCount` (`rounds.rounds.length`,
 * `undefined` while `list-rounds` is still pending) through {@link
 * nextBriefStripOpenState}: collapsed until that first resolves, then
 * expanded only if it resolved to zero. A live transition out of zero
 * (round 1 opening while the page stays mounted) collapses it once; any
 * round after that leaves the user's own choice alone. The comparison is
 * always against the last count this effect itself confirmed, never a value
 * assumed before `list-rounds` first answered — so a reload of a session
 * that already has rounds never shows expanded, not even for one frame.
 */
export function BriefStrip({
  hasProject,
  scoutReport,
  scoutWorking,
  readiness,
  readinessWorking,
  showReadiness,
  roundsCount,
  children,
}: {
  hasProject: boolean;
  scoutReport: ScoutReport | null;
  scoutWorking: boolean;
  readiness: Readiness | null;
  readinessWorking: boolean;
  /** The pre-round-1 readiness invitation still applies: no rounds yet. */
  showReadiness: boolean;
  /** `rounds.rounds.length`, or `undefined` while `list-rounds` is pending. */
  roundsCount: number | undefined;
  children: React.ReactNode;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const confirmedRoundsCount = useRef<number | null>(null);

  useEffect(() => {
    if (roundsCount === undefined) return;
    const previous = confirmedRoundsCount.current;
    confirmedRoundsCount.current = roundsCount;
    setOpen((current) =>
      nextBriefStripOpenState({
        previousConfirmedCount: previous,
        roundsCount,
        currentOpen: current,
      }),
    );
  }, [roundsCount]);

  if (!hasProject && readiness === null && !showReadiness) return null;

  const input: BriefSummaryInput = {
    hasProject,
    scoutReport,
    scoutWorking,
    readiness,
    readinessWorking,
  };
  const scoutPart = briefScoutPart(input, t);
  const readinessPart = briefReadinessPart(input, t);
  const summary = briefSummary(input, t);

  return (
    <div className="mb-4" data-testid="brief-strip">
      <Collapsible open={open} onOpenChange={setOpen}>
        {/*
         * The border and its rounding live on the trigger itself, not a
         * separate wrapping box: `hover:bg-accent` then always follows the
         * same corners the border draws, collapsed or expanded, with no
         * separate radius to drift out of sync (DESIGN.md's shape language).
         * Expanded, the bottom corners square off and the bottom border
         * drops (`data-[state=open]`), so this row reads as an open flap
         * rather than a box wrapped around the child cards below it — those
         * keep their own border untouched, so no card ever nests inside
         * another (DESIGN.md, "Rules over boxes... Cards never nest").
         */}
        <CollapsibleTrigger
          data-testid="brief-toggle"
          className="flex w-full items-center gap-2 rounded-lg border px-3 py-2 text-left hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none data-[state=open]:rounded-b-none data-[state=open]:border-b-0"
        >
          <IconChevronRight
            className="size-4 shrink-0 text-muted-foreground transition-transform data-[open=true]:rotate-90"
            data-open={open}
          />
          <span className="shrink-0 text-xs font-medium tracking-wide text-muted-foreground uppercase">
            {t("workspace.briefLabel")}
          </span>
          <span
            data-testid="brief-summary"
            title={summary}
            aria-label={summary}
            className="flex min-w-0 flex-1 items-baseline gap-1 font-mono text-xs text-muted-foreground"
          >
            {scoutPart !== null ? (
              <>
                <span className="min-w-0 flex-1 truncate">{scoutPart}</span>
                <span className="shrink-0" aria-hidden="true">
                  ·
                </span>
              </>
            ) : null}
            <span className="shrink-0">{readinessPart}</span>
          </span>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="flex flex-col gap-4 pt-4">{children}</div>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}
