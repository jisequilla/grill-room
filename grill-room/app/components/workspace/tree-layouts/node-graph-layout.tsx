import { useT } from "@agent-native/core/client/i18n";
import { useEffect, useMemo, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { DECISION_STATE_LABEL_KEY, type TreeDecision } from "@/lib/decisions";
import { computeNodeDepths } from "@/lib/tree-layout";
import { cn } from "@/lib/utils";

/** How many nodes the prototype draws before it stops rather than choke. */
const NODE_CAP = 80;

const NODE_WIDTH = 172;
const NODE_HEIGHT = 46;
const H_GAP = 22;
const V_GAP = 60;
const PADDING = 32;

const NODE_STYLE_BY_STATE: Record<TreeDecision["state"], string> = {
  settled:
    "fill-emerald-600/10 stroke-emerald-600/60 dark:fill-emerald-400/10 dark:stroke-emerald-400/60",
  frontier:
    "fill-sky-600/10 stroke-sky-600/60 dark:fill-sky-400/10 dark:stroke-sky-400/60",
  blocked: "fill-[hsl(var(--muted))] stroke-[hsl(var(--border))]",
  stale:
    "fill-amber-500/15 stroke-amber-600/60 dark:fill-amber-400/10 dark:stroke-amber-400/60",
  withdrawn: "fill-transparent stroke-[hsl(var(--border))]",
  unplaced:
    "fill-violet-600/10 stroke-violet-600/50 dark:fill-violet-400/10 dark:stroke-violet-400/50",
};

function truncateTitle(title: string, max = 30): string {
  return title.length > max ? `${title.slice(0, max - 1)}…` : title;
}

interface NodePosition {
  x: number;
  y: number;
}

interface GraphLayout {
  positions: Map<string, NodePosition>;
  width: number;
  height: number;
}

/**
 * A top-down grid: rows are depth (one more than the deepest dependency),
 * nodes within a row spread evenly and centred against the widest row. Hand
 * rolled on purpose — this is a prototype, not a graph library integration.
 */
function layoutGraph(decisions: readonly TreeDecision[]): GraphLayout {
  const depths = computeNodeDepths(decisions);
  const rows = new Map<number, TreeDecision[]>();
  for (const decision of decisions) {
    const depth = depths.get(decision.id) ?? 0;
    const row = rows.get(depth);
    if (row) row.push(decision);
    else rows.set(depth, [decision]);
  }

  const rowWidths = new Map<number, number>();
  for (const [depth, row] of rows) {
    rowWidths.set(depth, row.length * NODE_WIDTH + (row.length - 1) * H_GAP);
  }
  const width = Math.max(NODE_WIDTH, ...rowWidths.values(), 0);

  const positions = new Map<string, NodePosition>();
  for (const [depth, row] of rows) {
    const rowWidth = rowWidths.get(depth) ?? NODE_WIDTH;
    const startX = (width - rowWidth) / 2;
    row.forEach((decision, index) => {
      positions.set(decision.id, {
        x: startX + index * (NODE_WIDTH + H_GAP),
        y: depth * (NODE_HEIGHT + V_GAP),
      });
    });
  }

  const maxDepth = rows.size === 0 ? 0 : Math.max(...rows.keys());
  const height = (maxDepth + 1) * NODE_HEIGHT + maxDepth * V_GAP;

  return { positions, width, height };
}

interface Transform {
  x: number;
  y: number;
  k: number;
}

function GraphEdge({ from, to }: { from: NodePosition; to: NodePosition }) {
  const x1 = from.x + NODE_WIDTH / 2;
  const y1 = from.y + NODE_HEIGHT;
  const x2 = to.x + NODE_WIDTH / 2;
  const y2 = to.y;
  const midY = y1 + V_GAP / 2;

  return (
    <path
      d={`M ${x1},${y1} L ${x1},${midY} L ${x2},${midY} L ${x2},${y2}`}
      className="fill-none stroke-[hsl(var(--muted-foreground))]/45"
      strokeWidth={1.25}
      markerEnd="url(#tree-layout-graph-arrow)"
    />
  );
}

function GraphNode({
  decision,
  position,
  selected,
  onSelect,
  suppressClickRef,
}: {
  decision: TreeDecision;
  position: NodePosition;
  selected: boolean;
  onSelect: (decision: TreeDecision) => void;
  suppressClickRef: { current: boolean };
}) {
  const t = useT();
  const outlined =
    decision.state === "unplaced" || decision.state === "withdrawn";

  function select() {
    if (suppressClickRef.current) return;
    onSelect(decision);
  }

  return (
    <g
      transform={`translate(${position.x}, ${position.y})`}
      role="button"
      tabIndex={0}
      aria-current={selected ? "true" : undefined}
      data-testid="tree-layout-graph-node"
      data-state={decision.state}
      className="cursor-pointer outline-none"
      onClick={select}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          select();
        }
      }}
    >
      <title>{decision.questionTitle}</title>
      {selected ? (
        <rect
          x={-3}
          y={-3}
          width={NODE_WIDTH + 6}
          height={NODE_HEIGHT + 6}
          rx={10}
          className="fill-none stroke-[hsl(var(--ring))]"
          strokeWidth={2}
        />
      ) : null}
      <rect
        width={NODE_WIDTH}
        height={NODE_HEIGHT}
        rx={8}
        strokeWidth={1.25}
        strokeDasharray={outlined ? "4 3" : undefined}
        className={NODE_STYLE_BY_STATE[decision.state]}
      />
      <text
        x={10}
        y={19}
        className={cn(
          "fill-[hsl(var(--foreground))] text-[11px]",
          decision.state === "withdrawn" && "fill-[hsl(var(--muted-foreground))]",
        )}
      >
        {truncateTitle(decision.questionTitle)}
      </text>
      <text
        x={10}
        y={34}
        className="fill-[hsl(var(--muted-foreground))] text-[9px] tracking-wide uppercase"
      >
        {t(DECISION_STATE_LABEL_KEY[decision.state])}
      </text>
    </g>
  );
}

/**
 * The design tree as an SVG dependency graph: depth top to bottom, dependency
 * to dependent left to right within a row. Prototype: hand-rolled layout, no
 * graph library, capped at {@link NODE_CAP} nodes so a very large tree still
 * renders instead of freezing the panel.
 */
export function NodeGraphLayout({
  decisions,
  selectedId,
  onSelect,
}: {
  decisions: readonly TreeDecision[];
  selectedId: string | null;
  onSelect: (decision: TreeDecision) => void;
}) {
  const t = useT();
  const containerRef = useRef<HTMLDivElement>(null);
  const [transform, setTransform] = useState<Transform>({ x: 16, y: 16, k: 1 });
  const draggingRef = useRef(false);
  const movedRef = useRef(false);
  const lastPointRef = useRef({ x: 0, y: 0 });

  const capped = decisions.length > NODE_CAP;
  const visible = capped ? decisions.slice(0, NODE_CAP) : decisions;

  const layout = useMemo(() => layoutGraph(visible), [visible]);

  function fitToPanel() {
    const container = containerRef.current;
    if (!container) return;
    const availableWidth = container.clientWidth - PADDING * 2;
    const availableHeight = container.clientHeight - PADDING * 2;
    if (availableWidth <= 0 || availableHeight <= 0) return;
    const scale = Math.min(
      1,
      availableWidth / layout.width,
      availableHeight / layout.height,
    );
    const k = Number.isFinite(scale) && scale > 0 ? scale : 1;
    setTransform({
      x: (container.clientWidth - layout.width * k) / 2,
      y: PADDING,
      k,
    });
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps -- refit whenever the graph's own shape changes
  useEffect(fitToPanel, [layout.width, layout.height]);

  function onPointerDown(event: React.PointerEvent<SVGSVGElement>) {
    draggingRef.current = true;
    movedRef.current = false;
    lastPointRef.current = { x: event.clientX, y: event.clientY };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function onPointerMove(event: React.PointerEvent<SVGSVGElement>) {
    if (!draggingRef.current) return;
    const dx = event.clientX - lastPointRef.current.x;
    const dy = event.clientY - lastPointRef.current.y;
    if (Math.abs(dx) > 2 || Math.abs(dy) > 2) movedRef.current = true;
    lastPointRef.current = { x: event.clientX, y: event.clientY };
    setTransform((current) => ({ ...current, x: current.x + dx, y: current.y + dy }));
  }

  function onPointerUp() {
    draggingRef.current = false;
    // Let the click that follows a real drag land on nothing; a plain click
    // (no movement) still reaches the node underneath.
    if (movedRef.current) {
      setTimeout(() => {
        movedRef.current = false;
      }, 0);
    }
  }

  if (decisions.length === 0) {
    return (
      <p className="flex-1 px-2 py-6 text-center text-sm text-muted-foreground">
        {t("workspace.treeEmpty")}
      </p>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center justify-between gap-2 px-2 py-1.5">
        <p className="text-[11px] text-muted-foreground">
          {capped
            ? t("workspace.layoutGraphShowingFirst", {
                count: NODE_CAP,
                total: decisions.length,
              })
            : null}
        </p>
        <Button type="button" variant="outline" size="sm" onClick={fitToPanel}>
          {t("workspace.layoutGraphFitToPanel")}
        </Button>
      </div>
      <div
        ref={containerRef}
        className="min-h-0 flex-1 overflow-hidden rounded-md border bg-card/30"
      >
        <svg
          role="img"
          aria-label={t("workspace.layoutGraph")}
          width="100%"
          height="100%"
          className="cursor-grab touch-none active:cursor-grabbing"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerLeave={onPointerUp}
        >
          <defs>
            <marker
              id="tree-layout-graph-arrow"
              viewBox="0 0 8 8"
              refX="7"
              refY="4"
              markerWidth="7"
              markerHeight="7"
              orient="auto-start-reverse"
            >
              <path
                d="M0,0 L8,4 L0,8 z"
                className="fill-[hsl(var(--muted-foreground))]/45"
              />
            </marker>
          </defs>
          <g transform={`translate(${transform.x}, ${transform.y}) scale(${transform.k})`}>
            {visible.map((decision) =>
              decision.dependsOn
                .filter((id) => id !== decision.id && layout.positions.has(id))
                .map((dependencyId) => {
                  const from = layout.positions.get(dependencyId);
                  const to = layout.positions.get(decision.id);
                  if (!from || !to) return null;
                  return (
                    <GraphEdge
                      key={`${dependencyId}->${decision.id}`}
                      from={from}
                      to={to}
                    />
                  );
                }),
            )}
            {visible.map((decision) => {
              const position = layout.positions.get(decision.id);
              if (!position) return null;
              return (
                <GraphNode
                  key={decision.id}
                  decision={decision}
                  position={position}
                  selected={decision.id === selectedId}
                  onSelect={onSelect}
                  suppressClickRef={movedRef}
                />
              );
            })}
          </g>
        </svg>
      </div>
    </div>
  );
}
