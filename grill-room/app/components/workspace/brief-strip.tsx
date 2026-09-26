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
 * DESIGN.md's Brief strip summary line, e.g. "Scout: read 0c00712 · 2 kept, 6
 * dropped · Ready" (Composition, "Session workspace (the bench)"). A pure
 * function of the same data the route already fetches — `scoutReport` and
 * `round.readiness` — so a unit test can pin its exact text without
 * rendering the strip. {@link BriefStrip} is the only caller, passing it
 * `useT()`.
 *
 * With no project, the scout half never applies: the summary is the
 * readiness half alone (row 5 of the ticket's behaviour table).
 */
export function briefSummary(input: BriefSummaryInput, t: Translate): string {
  const readinessPart = input.readinessWorking
    ? t("workspace.briefReadinessJudging")
    : input.readiness
      ? t(
          input.readiness.result.verdict === "ready"
            ? "sessions.readinessReady"
            : "sessions.readinessNotReady",
        )
      : t("workspace.briefReadinessNotJudged");

  if (!input.hasProject) return readinessPart;

  const scoutPart = input.scoutWorking
    ? t("workspace.briefScoutReading")
    : input.scoutReport
      ? scoutReportSummary(input.scoutReport, t)
      : t("workspace.briefScoutNotRun");

  return t("workspace.briefSummary", { scout: scoutPart, readiness: readinessPart });
}

/**
 * The bench's one-line Brief strip: folds the project scout report and the
 * readiness judgment above the current ask, so nothing but this strip
 * renders above the round (DESIGN.md's anti-reference "Burying the current
 * ask"). `ScoutReportPanel` and `ReadinessPanel` are unchanged; the route
 * passes them in as `children`, exactly as it rendered them before — only
 * where they render moved.
 *
 * **Whether the strip renders at all** is a project, a stored readiness
 * judgment, or — to keep the readiness invitation reachable before the first
 * round exactly as it is today, with no project and no judgment yet —
 * `showReadiness` (the route's existing "no rounds yet, still interviewing"
 * flag). That last clause is what keeps `e2e/readiness.spec.ts` passing
 * unchanged: a fresh, project-less session must still show the readiness
 * panel before it has ever been assessed, which only `showReadiness` knows.
 *
 * **Whether it starts open** follows `roundsCount` (`rounds.rounds.length`,
 * `undefined` while `list-rounds` is still pending): collapsed until that
 * first resolves, then expanded only if it resolved to zero. A live
 * transition out of zero (round 1 opening while the page stays mounted)
 * collapses it once; any round after that leaves the user's own choice
 * alone. The comparison is always against the last count this effect itself
 * confirmed, never a value assumed before `list-rounds` first answered — so
 * a reload of a session that already has rounds never shows expanded, not
 * even for one frame.
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

    if (previous === null) {
      // The first time `list-rounds` resolves: decide the initial state from
      // it, never from a guess made before this ran.
      setOpen(roundsCount === 0);
      return;
    }

    // Only the transition out of zero rounds collapses the strip live: a
    // later round opening (1 -> 2, say) leaves whatever the user chose alone.
    if (previous === 0 && roundsCount > 0) setOpen(false);
  }, [roundsCount]);

  if (!hasProject && readiness === null && !showReadiness) return null;

  const summary = briefSummary(
    { hasProject, scoutReport, scoutWorking, readiness, readinessWorking },
    t,
  );

  return (
    <div className="mb-4 rounded-lg border" data-testid="brief-strip">
      <Collapsible open={open} onOpenChange={setOpen}>
        <CollapsibleTrigger
          data-testid="brief-toggle"
          className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        >
          <IconChevronRight
            className="size-4 shrink-0 text-muted-foreground transition-transform data-[open=true]:rotate-90"
            data-open={open}
          />
          <span className="shrink-0 text-xs font-medium tracking-wide text-muted-foreground uppercase">
            {t("workspace.briefLabel")}
          </span>
          <span
            className="truncate font-mono text-xs text-muted-foreground"
            data-testid="brief-summary"
          >
            {summary}
          </span>
        </CollapsibleTrigger>
        <CollapsibleContent className="border-t px-3 py-3">
          <div className="flex flex-col gap-4">{children}</div>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}
