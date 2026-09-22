import { useT } from "@agent-native/core/client/i18n";

import { LooseEndBadge } from "@/components/workspace/decision-state-badge";
import { isLooseEnd, type TreeDecision } from "@/lib/decisions";
import {
  groupByColumn,
  LAYOUT_COLUMN_ORDER,
  type LayoutColumn,
} from "@/lib/tree-layout";
import { cn } from "@/lib/utils";

const COLUMN_LABEL_KEY: Record<LayoutColumn, string> = {
  frontier: "workspace.stateFrontier",
  blocked: "workspace.stateBlocked",
  settled: "workspace.stateSettled",
  looseEnds: "workspace.layoutColumnLooseEnds",
};

function dependsOnLine(
  decision: TreeDecision,
  byId: Map<string, TreeDecision>,
  t: (key: string, values?: Record<string, unknown>) => string,
): string {
  if (decision.dependsOn.length === 0) return t("workspace.dependsOnNothing");
  const titles = decision.dependsOn
    .map((id) => byId.get(id)?.questionTitle)
    .filter((title): title is string => Boolean(title));
  if (titles.length === 0) return t("workspace.dependsOnNothing");
  return t("workspace.layoutDependsOn", { list: titles.join(", ") });
}

function ColumnCard({
  decision,
  byId,
  selected,
  onSelect,
}: {
  decision: TreeDecision;
  byId: Map<string, TreeDecision>;
  selected: boolean;
  onSelect: (decision: TreeDecision) => void;
}) {
  const t = useT();
  const withdrawn = decision.state === "withdrawn";
  const unplaced = decision.state === "unplaced";
  // The column already says the state; a per-card badge would only repeat
  // it. The one exception is the Loose ends & stale column, which mixes two
  // different reasons for being there — this marks which of the two.
  const loose = isLooseEnd(decision);

  return (
    <button
      type="button"
      onClick={() => onSelect(decision)}
      aria-current={selected ? "true" : undefined}
      data-testid="tree-layout-columns-card"
      data-state={decision.state}
      className={cn(
        "flex w-full flex-col gap-1 rounded-md border bg-card px-2.5 py-2 text-left transition-colors",
        "hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
        selected && "bg-accent",
        (withdrawn || unplaced) && "opacity-60",
      )}
    >
      <div className="flex items-start justify-between gap-1.5">
        <span
          className={cn(
            "min-w-0 flex-1 text-[13px] leading-5",
            withdrawn && "text-muted-foreground/70 line-through",
          )}
        >
          {decision.questionTitle}
        </span>
        {loose ? (
          <span className="mt-px shrink-0">
            <LooseEndBadge />
          </span>
        ) : null}
      </div>
      <span className="truncate text-[11px] text-muted-foreground">
        {dependsOnLine(decision, byId, t)}
      </span>
    </button>
  );
}

/**
 * The design tree redrawn as four columns by state, so the question "what can
 * I answer right now" reads as a group instead of a scan of badge colours
 * down an outline. Prototype: the outline stays the default and this exists
 * for the user to react to, not to replace it.
 */
export function ColumnsLayout({
  decisions,
  selectedId,
  onSelect,
}: {
  decisions: readonly TreeDecision[];
  selectedId: string | null;
  onSelect: (decision: TreeDecision) => void;
}) {
  const t = useT();
  const byId = new Map(decisions.map((decision) => [decision.id, decision]));
  const groups = groupByColumn(decisions);

  // The tree panel is a narrow aside, not the main canvas, so four columns
  // never fit side by side at its width — a viewport-width breakpoint (e.g.
  // `xl:grid-cols-4`) would fire from the *page's* width and cram them in
  // regardless. Each column gets a fixed width instead and the row scrolls
  // horizontally; a column's own card list scrolls vertically on its own.
  return (
    <div className="flex min-h-0 flex-1 gap-3 overflow-x-auto p-2">
      {LAYOUT_COLUMN_ORDER.map((column) => (
        <div key={column} className="flex min-h-0 w-48 shrink-0 flex-col gap-1.5">
          <div className="flex items-center justify-between px-0.5">
            <p className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
              {t(COLUMN_LABEL_KEY[column])}
            </p>
            <span className="text-[11px] tabular-nums text-muted-foreground">
              {groups[column].length}
            </span>
          </div>
          <div className="min-h-0 flex-1 space-y-1.5 overflow-y-auto pr-0.5 pb-1">
            {groups[column].length === 0 ? (
              <p className="rounded-md border border-dashed px-2.5 py-3 text-center text-[11px] text-muted-foreground">
                {t("workspace.layoutColumnEmpty")}
              </p>
            ) : (
              groups[column].map((decision) => (
                <ColumnCard
                  key={decision.id}
                  decision={decision}
                  byId={byId}
                  selected={decision.id === selectedId}
                  onSelect={onSelect}
                />
              ))
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
