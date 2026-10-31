import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

const { mutate, onSelects, mutationActions, mutationOptions, toastError, errorMessage } = vi.hoisted(() => ({
  mutate: vi.fn(),
  mutationActions: [] as string[],
  onSelects: {} as Record<string, () => void>,
  mutationOptions: {} as { onError?: (error: unknown) => void },
  toastError: vi.fn(),
  errorMessage: { value: null as string | null },
}));

vi.mock("sonner", () => ({ toast: { error: toastError } }));

vi.mock("@agent-native/core/client/hooks", () => ({
  useActionMutation: (name: string, options: { onError?: (error: unknown) => void }) => {
    mutationActions.push(name);
    mutationOptions.onError = options.onError;
    return { mutate, isPending: false };
  },
  actionErrorMessage: () => errorMessage.value,
}));

// The set-aside kind labels read from the app's real English strings; every
// other key keeps the framework's default rendering the tests above rely on.
vi.mock("@agent-native/core/client/i18n", async (importOriginal) => {
  const original = await importOriginal<typeof import("@agent-native/core/client/i18n")>();
  const { default: messages } = await import("@/i18n/en-US");
  return {
    ...original,
    useT: () => {
      const frameworkT = original.useT();
      return ((key: string, ...rest: unknown[]) =>
        key.startsWith("workspace.setAsideKind") || key === "workspace.moveSetAside" ||
        key === "workspace.moveSetAsideFailed"
          ? (messages.workspace as Record<string, string>)[key.slice("workspace.".length)]
          : (frameworkT as (...args: unknown[]) => string)(key, ...rest)) as typeof frameworkT;
    },
  };
});

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

// A closed Radix menu renders nothing in static markup: show its items inline
// and keep each item's onSelect so a test can fire it.
vi.mock("@/components/ui/dropdown-menu", () => {
  const Plain = ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  );
  return {
    DropdownMenu: Plain,
    DropdownMenuTrigger: Plain,
    DropdownMenuContent: Plain,
    DropdownMenuItem: ({
      children,
      onSelect,
      "data-testid": testId,
    }: {
      children?: React.ReactNode;
      onSelect?: () => void;
      "data-testid"?: string;
    }) => {
      onSelects[testId!] = onSelect!;
      return <button data-testid={testId}>{children}</button>;
    },
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

describe("DecisionDetailSheet set-aside decisions", () => {
  const setAside = (overrides: Partial<TreeDecision> = {}) =>
    aDecision({
      answer: { text: "The builder picks it.", kind: "dispositioned" },
      dispositionTarget: "builders-call",
      ...overrides,
    });

  it("a settled set-aside decision shows its kind and the Move to menu", () => {
    const html = render(setAside());

    expect(html).toMatch(/data-testid="set-aside-kind"[^>]*>Builder(&#x27;|')s call</);
    expect(html).toContain('data-testid="move-set-aside"');
  });

  it("a stale or withdrawn set-aside decision shows its kind but no Move to menu", () => {
    for (const state of ["stale", "withdrawn"] as const) {
      const html = render(setAside({ state }));

      expect(html).toContain('data-testid="set-aside-kind"');
      expect(html).not.toContain('data-testid="move-set-aside"');
    }
  });

  it("no other decision shows the Move to menu", () => {
    const own = render(aDecision());
    const looseEnd = render(
      aDecision({ state: "frontier", answer: { text: "", kind: "unknown" } }),
    );

    for (const html of [own, looseEnd]) {
      expect(html).not.toContain('data-testid="move-set-aside"');
      expect(html).not.toContain('data-testid="set-aside-kind"');
    }
  });

  it("the Move to menu offers the other two targets, in order, and moves on select", () => {
    mutate.mockClear();
    mutationActions.length = 0;
    const html = render(setAside());

    expect(mutationActions).toContain("move-set-aside-decision");

    expect(html).toMatch(/data-testid="move-set-aside"[^>]*>(<svg.*?<\/svg>)?Move to…</);
    const items = [...html.matchAll(/data-testid="(move-to-[a-z-]+)"[^>]*>([^<]*)</g)].map(
      (m) => [m[1], m[2]],
    );
    expect(items).toEqual([
      ["move-to-out-of-scope", "Out of scope"],
      ["move-to-open-question", "Open question"],
    ]);

    onSelects["move-to-open-question"]();
    expect(mutate).toHaveBeenCalledTimes(1);
    expect(mutate).toHaveBeenCalledWith({ decisionId: "decision-1", target: "open-question" });
  });

  it("the footer holds Reopen beside the Move to menu when settled, and is absent when withdrawn", () => {
    const settled = render(setAside());
    const withdrawn = render(setAside({ state: "withdrawn" }));

    expect(settled).toContain("mt-auto");
    expect(settled).toContain("Reopen");
    expect(withdrawn).not.toContain("mt-auto");
  });

  it("a failed move shows the server's message, or the fallback when it has none", () => {
    toastError.mockClear();
    render(setAside());

    errorMessage.value = "The interviewer is working on this session.";
    mutationOptions.onError!(new Error("x"));
    errorMessage.value = null;
    mutationOptions.onError!(new Error("x"));

    expect(toastError.mock.calls).toEqual([
      ["The interviewer is working on this session."],
      ["Could not move that decision."],
    ]);
  });
});
