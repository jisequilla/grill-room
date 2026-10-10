import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@agent-native/core/client/hooks", () => ({
  useActionMutation: () => ({ mutate: vi.fn(), isPending: false }),
  actionErrorMessage: () => null,
}));

// Radix portals render nothing in static markup; the sheet's own content is
// what these tests read.
vi.mock("@/components/ui/sheet", () => {
  const Plain = ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  );
  return {
    Sheet: Plain,
    SheetContent: Plain,
    SheetHeader: Plain,
    SheetTitle: Plain,
    SheetDescription: Plain,
  };
});

import { TooltipProvider } from "@/components/ui/tooltip";
import { DecisionDetailSheet } from "@/components/workspace/decision-detail-sheet";
import type { TreeDecision } from "@/lib/decisions";

function aDecision(overrides: Partial<TreeDecision> = {}): TreeDecision {
  return {
    id: "decision-1",
    key: "key-1",
    questionTitle: "Decision 1",
    questionBody: "",
    choices: [],
    recommendedChoice: null,
    recommendedChoiceLabel: null,
    recommendedAnswer: null,
    dependsOn: [],
    introducedBy: "interviewer",
    repo: null,
    adrWorthy: false,
    consequences: null,
    replacedBy: null,
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

function render(decision: TreeDecision) {
  return renderToStaticMarkup(
    <TooltipProvider>
      <DecisionDetailSheet
        decision={decision}
        decisions={[decision]}
        open
        onOpenChange={() => {}}
        returnFocusTo={{ current: null }}
      />
    </TooltipProvider>,
  );
}

describe("DecisionDetailSheet ADR section", () => {
  it("renders the editable controls with Save disabled", () => {
    const html = render(aDecision());

    expect(html).toContain('data-testid="adr-worthy-toggle"');
    expect(html).toContain('data-testid="adr-consequences"');
    expect(html).toMatch(/<button[^>]*data-testid="adr-save"[^>]*disabled/);
    expect(html).not.toContain('data-testid="adr-readonly"');
  });

  it("renders a flagged unsettled decision read-only with its Consequences", () => {
    const html = render(
      aDecision({
        state: "frontier",
        answer: null,
        adrWorthy: true,
        consequences: "Hard to undo later.",
      }),
    );

    expect(html).toContain('data-testid="adr-readonly"');
    expect(html).toContain("Hard to undo later.");
    expect(html).toContain('data-testid="adr-locked-reason"');
    expect(html).toContain(
      'data-testid="adr-locked-reason">Adr locked not settled<',
    );
    expect(html).not.toContain('data-testid="adr-worthy-toggle"');
  });

  it("renders the replaced reason for a replaced decision", () => {
    const html = render(
      aDecision({
        replacedBy: { id: "d2", key: "k2", title: "Later", reason: "r" },
      }),
    );

    expect(html).toContain(
      'data-testid="adr-locked-reason">Adr locked replaced<',
    );
    expect(html).not.toContain("Adr locked not settled");
    expect(html).not.toContain('data-testid="adr-worthy-toggle"');
  });
});
