import { isLooseEnd, type TreeDecision } from "@/lib/decisions";

/**
 * A decision's depth for the node-graph prototype: one more than the deepest
 * of its dependencies, 0 for a decision that depends on nothing placed in the
 * tree. Tolerates what the tree already tolerates elsewhere — a dangling
 * dependency id is ignored, and a decision caught in a cycle still resolves to
 * a depth rather than recursing forever, so a bad graph renders instead of
 * hanging the panel.
 */
export function computeNodeDepths(
  decisions: readonly TreeDecision[],
): Map<string, number> {
  const byId = new Map(decisions.map((decision) => [decision.id, decision]));
  const depths = new Map<string, number>();
  const visiting = new Set<string>();

  function depthOf(id: string): number {
    const cached = depths.get(id);
    if (cached !== undefined) return cached;
    if (visiting.has(id)) return 0; // mid-cycle: stop recursing, not looping
    const decision = byId.get(id);
    if (!decision) return 0; // dangling dependency id: treat as not there

    visiting.add(id);
    let depth = 0;
    for (const dependencyId of decision.dependsOn) {
      if (dependencyId === id || !byId.has(dependencyId)) continue;
      depth = Math.max(depth, depthOf(dependencyId) + 1);
    }
    visiting.delete(id);
    depths.set(id, depth);
    return depth;
  }

  for (const decision of decisions) depthOf(decision.id);
  return depths;
}

/** The four groupings the columns-by-state prototype lays out side by side. */
export type LayoutColumn = "frontier" | "blocked" | "settled" | "looseEnds";

export const LAYOUT_COLUMN_ORDER: readonly LayoutColumn[] = [
  "frontier",
  "blocked",
  "settled",
  "looseEnds",
];

/**
 * Which column a decision belongs in. A steering-move answer (unknown,
 * deferred, pushed back, prototype flagged) or a stale state always reads as
 * "loose ends and stale" regardless of what its own dependency readiness would
 * otherwise compute to — that column is the one place everything needing
 * attention collects. Withdrawn decisions fall under Settled and unplaced
 * ones under Blocked, both sorted to the bottom of their column by
 * {@link groupByColumn} rather than singled out here.
 */
export function assignColumn(decision: TreeDecision): LayoutColumn {
  if (decision.state === "withdrawn") return "settled";
  if (decision.state === "unplaced") return "blocked";
  if (decision.state === "stale" || isLooseEnd(decision)) return "looseEnds";
  if (decision.state === "settled") return "settled";
  if (decision.state === "frontier") return "frontier";
  return "blocked";
}

/**
 * Every decision sorted into its column, withdrawn pushed to the bottom of
 * Settled and unplaced to the bottom of Blocked. `Array.prototype.sort` is
 * stable, so this only ever moves those two groups down without otherwise
 * reordering a column.
 */
export function groupByColumn(
  decisions: readonly TreeDecision[],
): Record<LayoutColumn, TreeDecision[]> {
  const groups: Record<LayoutColumn, TreeDecision[]> = {
    frontier: [],
    blocked: [],
    settled: [],
    looseEnds: [],
  };

  for (const decision of decisions) {
    groups[assignColumn(decision)].push(decision);
  }

  groups.settled.sort(
    (a, b) => Number(a.state === "withdrawn") - Number(b.state === "withdrawn"),
  );
  groups.blocked.sort(
    (a, b) => Number(a.state === "unplaced") - Number(b.state === "unplaced"),
  );

  return groups;
}
