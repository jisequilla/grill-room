import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { BatchProgressTrack } from "@/components/workspace/batch/batch-progress-panel";
import type {
  BatchOutcome,
  BatchOutcomeStatus,
  StoredBatchProgress,
} from "@/components/workspace/batch/batch-result";

/*
 * Rendered with the bare `renderToStaticMarkup` pattern the other workspace
 * component tests use: no i18n catalog, so assertions read the segments' own
 * data attributes and colour classes, never label text.
 */

function outcome(status: BatchOutcomeStatus, index: number): BatchOutcome {
  return {
    decisionId: `decision-${index}`,
    key: `key-${index}`,
    title: `Decision ${index}`,
    status,
    state: "settled",
    error:
      status === "failed" ? { code: "turn-failed", message: "It failed." } : null,
  } as BatchOutcome;
}

/** Each segment's status and colour class, in order. */
function segments(progress: StoredBatchProgress): { status: string; colour: string }[] {
  const html = renderToStaticMarkup(<BatchProgressTrack progress={progress} />);
  return [...html.matchAll(/<span[^>]*data-status="([^"]+)"[^>]*class="([^"]+)"/g)].map(
    ([, status, classes]) => ({
      status,
      colour: classes.split(" ").find((name) => name.startsWith("bg-")) ?? "",
    }),
  );
}

describe("BatchProgressTrack", () => {
  it("colours each processed segment by its own outcome, and leaves the rest on the neutral track", () => {
    const statuses: BatchOutcomeStatus[] = [
      "reopened",
      "answered-as-card",
      "answered-as-loose-end",
      "not-reopenable",
      "failed",
    ];

    expect(
      segments({
        total: 7,
        completed: statuses.length,
        current: null,
        outcomes: statuses.map(outcome),
      }),
    ).toEqual([
      { status: "reopened", colour: "bg-settled" },
      { status: "answered-as-card", colour: "bg-settled" },
      { status: "answered-as-loose-end", colour: "bg-owed" },
      { status: "not-reopenable", colour: "bg-unplaced" },
      { status: "failed", colour: "bg-destructive" },
      { status: "pending", colour: "bg-muted-foreground/25" },
      { status: "pending", colour: "bg-muted-foreground/25" },
    ]);
  });

  it("never paints a skipped item or a loose end as settled, wherever it falls in the batch", () => {
    const colours = segments({
      total: 3,
      completed: 3,
      current: null,
      outcomes: [
        outcome("not-reopenable", 0),
        outcome("answered-as-loose-end", 1),
        outcome("reopened", 2),
      ],
    }).map((segment) => segment.colour);

    expect(colours).toEqual(["bg-unplaced", "bg-owed", "bg-settled"]);
  });
});
