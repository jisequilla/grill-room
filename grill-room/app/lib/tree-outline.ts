import type { TreeDecision } from "@/lib/decisions";

export interface OutlineRow {
  decision: TreeDecision;
  /** How far the row is indented: 0 for a decision that depends on nothing. */
  depth: number;
  /**
   * The dependencies this row is *not* nested under. A decision hangs off its
   * first dependency; the rest are named here so the outline can say so without
   * drawing the same decision twice.
   */
  otherParents: TreeDecision[];
}

export interface TreeOutline {
  rows: OutlineRow[];
  /** User-added decisions the interviewer has not placed in the tree yet. */
  unplaced: TreeDecision[];
}

/**
 * The design tree as an indented outline.
 *
 * A decision is nested under the first of its dependencies that is in the tree;
 * decisions with none are roots, in the order given. Unplaced decisions are
 * pulled out of the outline entirely — they have no dependencies yet, so
 * showing them as roots would claim a shape the interviewer has not decided.
 *
 * Tolerates what the tree should never contain: a dangling dependency id is
 * ignored, and a decision caught in a cycle is rendered as a root rather than
 * dropped, so a bad graph is visible rather than invisible.
 */
export function buildTreeOutline(
  decisions: readonly TreeDecision[],
): TreeOutline {
  const unplaced = decisions.filter(
    (decision) => decision.state === "unplaced",
  );
  const placed = decisions.filter((decision) => decision.state !== "unplaced");
  const byId = new Map(placed.map((decision) => [decision.id, decision]));

  const parents = new Map<string, TreeDecision[]>();
  for (const decision of placed) {
    parents.set(
      decision.id,
      decision.dependsOn.flatMap((id) => {
        const parent = id === decision.id ? undefined : byId.get(id);
        return parent ? [parent] : [];
      }),
    );
  }

  const children = new Map<string, TreeDecision[]>();
  const roots: TreeDecision[] = [];
  for (const decision of placed) {
    const primary = parents.get(decision.id)?.[0];
    if (!primary) {
      roots.push(decision);
      continue;
    }
    const siblings = children.get(primary.id);
    if (siblings) siblings.push(decision);
    else children.set(primary.id, [decision]);
  }

  const rows: OutlineRow[] = [];
  const emitted = new Set<string>();

  function walk(decision: TreeDecision, depth: number): void {
    if (emitted.has(decision.id)) return;
    emitted.add(decision.id);
    rows.push({
      decision,
      depth,
      otherParents: (parents.get(decision.id) ?? []).slice(1),
    });
    for (const child of children.get(decision.id) ?? []) {
      walk(child, depth + 1);
    }
  }

  for (const root of roots) walk(root, 0);
  // Anything a cycle kept out of the walk, so no decision is ever invisible.
  for (const decision of placed) walk(decision, 0);

  return { rows, unplaced };
}

/** Every decision that would go stale if `decisionId` were reopened. */
export function transitiveDependentCount(
  decisions: readonly TreeDecision[],
  decisionId: string,
): number {
  const dependents = new Set<string>();
  const queue = [decisionId];

  while (queue.length > 0) {
    const current = queue.shift();
    if (current === undefined) continue;
    for (const decision of decisions) {
      if (dependents.has(decision.id) || decision.id === decisionId) continue;
      if (!decision.dependsOn.includes(current)) continue;
      dependents.add(decision.id);
      queue.push(decision.id);
    }
  }

  return dependents.size;
}
