import { useT } from "@agent-native/core/client/i18n";

import {
  DecisionStateBadge,
  LooseEndBadge,
} from "@/components/workspace/decision-state-badge";
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
      <div className="flex items-start justify-between gap-2">
        <span
          className={cn(
            "min-w-0 flex-1 text-[13px] leading-5",
            withdrawn && "text-muted-foreground/70 line-through",
          )}
        >
          {decision.questionTitle}
        </span>
        <span className="mt-px flex shrink-0 items-center gap-1">
          {loose ? <LooseEndBadge /> : null}
          <DecisionStateBadge state={decision.state} />
        </span>
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

  return (
    <div className="min-h-0 flex-1 overflow-auto p-2">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {LAYOUT_COLUMN_ORDER.map((column) => (
          <div key={column} className="flex min-w-0 flex-col gap-1.5">
            <div className="flex items-center justify-between px-0.5">
              <p className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
                {t(COLUMN_LABEL_KEY[column])}
              </p>
              <span className="text-[11px] tabular-nums text-muted-foreground">
                {groups[column].length}
              </span>
            </div>
            <div className="flex flex-col gap-1.5">
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
    </div>
  );
}
