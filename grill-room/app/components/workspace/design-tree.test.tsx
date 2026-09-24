import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { TooltipProvider } from "@/components/ui/tooltip";
import { DesignTree } from "@/components/workspace/design-tree";
import type { TreeDecision } from "@/lib/decisions";

let counter = 0;

function aDecision(overrides: Partial<TreeDecision> = {}): TreeDecision {
  counter += 1;
  return {
    id: `decision-${counter}`,
    key: `key-${counter}`,
    questionTitle: `Decision ${counter}`,
    questionBody: "",
    choices: [],
    recommendedChoice: null,
    recommendedChoiceLabel: null,
    recommendedAnswer: null,
    dependsOn: [],
    introducedBy: "interviewer",
    repo: null,
    state: "settled",
    answer: { text: "An answer", kind: "own-answer" },
    supersession: null,
    dispositionTarget: null,
    settledAt: "2026-09-24T10:00:00.000Z",
    reopenedAt: null,
    withdrawnAt: null,
    awaitingPlacementSince: null,
    createdAt: "2026-09-24T09:00:00.000Z",
    previousAnswers: [],
    ...overrides,
  } as TreeDecision;
}

function render(decisions: readonly TreeDecision[]) {
  return renderToStaticMarkup(
    <TooltipProvider>
      <DesignTree decisions={decisions} selectedId={null} onSelect={() => {}} />
    </TooltipProvider>,
  );
}

describe("DesignTree", () => {
  it("shows no repo marker for an ordinary decision", () => {
    const html = render([aDecision({ repo: null })]);

    expect(html).not.toContain('data-testid="repo-marker"');
  });

  it("marks a repo decision as recorded, with its citation", () => {
    const html = render([
      aDecision({
        introducedBy: "repo",
        repo: {
          source: "recorded",
          citation: "docs/adr/0003-queue.md:5-9",
          statement: "Ingest runs on a Postgres-backed queue.",
          scoutReportId: "report-1",
        },
      }),
    ]);

    expect(html).toContain('data-testid="repo-marker"');
    expect(html).toContain('data-source="recorded"');
    expect(html).toContain('data-citation="docs/adr/0003-queue.md:5-9"');
  });

  it("marks a repo decision as inferred", () => {
    const html = render([
      aDecision({
        introducedBy: "repo",
        repo: {
          source: "inferred",
          citation: "CLAUDE.md:1",
          statement: "CLAUDE.md exists at the repo root.",
          scoutReportId: "report-1",
        },
      }),
    ]);

    expect(html).toContain('data-source="inferred"');
  });
});
