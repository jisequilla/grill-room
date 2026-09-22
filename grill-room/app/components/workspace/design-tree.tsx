import { useT } from "@agent-native/core/client/i18n";

import {
  DecisionStateBadge,
  LooseEndBadge,
} from "@/components/workspace/decision-state-badge";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { isLooseEnd, type TreeDecision } from "@/lib/decisions";
import { buildTreeOutline, type OutlineRow } from "@/lib/tree-outline";
import { cn } from "@/lib/utils";

const INDENT_REM = 0.875;

function DecisionRow({
  decision,
  depth,
  otherParents,
  selected,
  onSelect,
}: OutlineRow & {
  selected: boolean;
  onSelect: (decision: TreeDecision) => void;
}) {
  const t = useT();
  const withdrawn = decision.state === "withdrawn";
  const loose = isLooseEnd(decision);

  return (
    <li>
      <button
        type="button"
        onClick={() => onSelect(decision)}
        aria-current={selected ? "true" : undefined}
        data-testid="tree-row"
        data-state={decision.state}
        className={cn(
          "group flex w-full items-start gap-2 rounded-md py-1.5 pr-2 text-left transition-colors",
          "hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
          selected && "bg-accent",
        )}
        style={{ paddingLeft: `${0.375 + depth * INDENT_REM}rem` }}
      >
        {depth > 0 ? (
          <span
            aria-hidden
            className="mt-[0.4rem] h-px w-2 shrink-0 bg-border group-hover:bg-muted-foreground/40"
          />
        ) : null}
        <span
          className={cn(
            "min-w-0 flex-1 text-[13px] leading-5",
            withdrawn && "text-muted-foreground/70 line-through",
            decision.state === "stale" && "font-medium",
          )}
        >
          {decision.questionTitle}
          {otherParents.length > 0 ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="ml-1.5 inline-block cursor-default rounded bg-muted px-1 font-mono text-[10px] whitespace-nowrap text-muted-foreground">
                  {t("workspace.moreDependencies", {
                    count: otherParents.length,
                  })}
                </span>
              </TooltipTrigger>
              <TooltipContent className="max-w-xs">
                <p className="text-[11px] font-medium">
                  {t("workspace.alsoDependsOn")}
                </p>
                <ul className="mt-0.5 list-disc pl-4 text-xs">
                  {otherParents.map((parent) => (
                    <li key={parent.id}>{parent.questionTitle}</li>
                  ))}
                </ul>
              </TooltipContent>
            </Tooltip>
          ) : null}
        </span>
        <span className="mt-px flex shrink-0 items-center gap-1">
          {loose ? <LooseEndBadge /> : null}
          <DecisionStateBadge state={decision.state} />
        </span>
      </button>
    </li>
  );
}

/**
 * Every decision of the session as an indented outline: each one sits under the
 * first decision it depends on, with the rest named on a marker beside it.
 */
export function DesignTree({
  decisions,
  selectedId,
  onSelect,
}: {
  decisions: readonly TreeDecision[];
  selectedId: string | null;
  onSelect: (decision: TreeDecision) => void;
}) {
  const t = useT();
  const { rows, unplaced } = buildTreeOutline(decisions);

  if (decisions.length === 0) {
    return (
      <p className="px-2 py-6 text-center text-sm text-muted-foreground">
        {t("workspace.treeEmpty")}
      </p>
    );
  }

  return (
    <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-2">
      <ul className="space-y-px">
        {rows.map((row) => (
          <DecisionRow
            key={row.decision.id}
            {...row}
            selected={row.decision.id === selectedId}
            onSelect={onSelect}
          />
        ))}
      </ul>

      {unplaced.length > 0 ? (
        <div>
          <p className="px-1.5 pb-1 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
            {t("workspace.unplacedGroup")}
          </p>
          <ul className="space-y-px">
            {unplaced.map((decision) => (
              <DecisionRow
                key={decision.id}
                decision={decision}
                depth={0}
                otherParents={[]}
                selected={decision.id === selectedId}
                onSelect={onSelect}
              />
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
