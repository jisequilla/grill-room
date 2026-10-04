import type { ReactElement, ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import enUS from "@/i18n/en-US";

import { DelegationProposalList } from "@/components/output/export-section";

type Proposal = Parameters<typeof DelegationProposalList>[0]["proposals"][number];

const OUTPUT_MESSAGES: Record<string, string> = enUS.output;

/** The en-US message for a key such as `output.exportDelegationConfirm`, with `{{name}}` filled. */
function t(key: string, params: Record<string, string | number> = {}): string {
  const message = OUTPUT_MESSAGES[key.replace(/^output\./, "")];
  if (message === undefined) throw new Error(`No en-US message for ${key}`);
  return message.replace(/\{\{(\w+)\}\}/g, (_, name: string) => String(params[name]));
}

const PRUNE: Proposal = {
  slot: "pruneCommand",
  proposal: { command: "just prune", citation: "CLAUDE.md:4" },
  confirmed: null,
};
const CAP: Proposal = {
  slot: "maxTicketsInFlight",
  proposal: { value: 2, citation: "CLAUDE.md:7" },
  confirmed: { value: 5, citation: "CLAUDE.md:7" },
};
const RULE: Proposal = {
  slot: "reviewRule",
  proposal: { citation: "AGENTS.md:3" },
  confirmed: null,
};

function noop() {}

function render(proposals: Proposal[], busySlot: Proposal["slot"] | null = null): string {
  return renderToStaticMarkup(
    <DelegationProposalList proposals={proposals} busySlot={busySlot} onConfirm={noop} onDismiss={noop} t={t} />,
  );
}

/** Every element in a returned element tree, depth first. */
function elementsOf(node: ReactNode): ReactElement<Record<string, unknown>>[] {
  if (Array.isArray(node)) return node.flatMap(elementsOf);
  if (node === null || typeof node !== "object" || !("props" in node)) return [];
  const element = node as ReactElement<{ children?: ReactNode }>;
  return [element as ReactElement<Record<string, unknown>>, ...elementsOf(element.props.children)];
}

function byTestId(tree: ReactNode, testId: string): ReactElement<Record<string, unknown>> {
  const found = elementsOf(tree).find((element) => element.props["data-testid"] === testId);
  if (!found) throw new Error(`No element with data-testid ${testId}`);
  return found;
}

describe("DelegationProposalList", () => {
  it("shows each proposal's label, value and citation, and the trade-off line", () => {
    const html = render([CAP, PRUNE, RULE]);

    expect(html).toContain('data-testid="export-delegation-proposals"');
    expect(html).toContain("Delegation values the repository proposes");
    expect(html).toContain('data-testid="export-delegation-proposal-maxTicketsInFlight"');
    expect(html).toContain("Tickets in flight");
    expect(html).toContain("<span>2</span>");
    expect(html).toContain("<code");
    expect(html).toContain("CLAUDE.md:7");
    expect(html).toContain('data-testid="export-delegation-proposal-pruneCommand"');
    expect(html).toContain("Prune command");
    expect(html).toContain("<code>just prune</code>");
    expect(html).toContain("CLAUDE.md:4");
    expect(html).toContain("Review rule");
    expect(html).toContain("AGENTS.md:3");
    expect(html).toContain(
      "Confirming or dismissing changes the handoff: regenerate it and ground the briefs again before exporting.",
    );
  });

  it("shows the confirmed value only for a slot that has one", () => {
    const withConfirmed = render([CAP]);
    expect(withConfirmed).toContain("Confirmed now:");
    expect(withConfirmed).toContain("<span>5</span>");

    expect(render([PRUNE, RULE])).not.toContain("Confirmed now:");
  });

  it("shows a confirmed prune command and a confirmed citation", () => {
    const html = render([
      { ...PRUNE, confirmed: { command: "make prune", citation: "CLAUDE.md:9" } },
      { slot: "preflight", proposal: { citation: "AGENTS.md:30" }, confirmed: { citation: "AGENTS.md:2" } },
    ]);

    expect(html).toContain("<code>make prune</code>");
    expect(html).toContain("CLAUDE.md:9");
    expect(html).toContain("Pre-flight procedure");
    expect(html).toContain("AGENTS.md:2");
  });

  it("renders both buttons of every item", () => {
    const html = render([PRUNE]);

    expect(html).toContain('data-testid="export-delegation-confirm-pruneCommand"');
    expect(html).toContain('data-testid="export-delegation-dismiss-pruneCommand"');
    expect(html).toContain(">Confirm<");
    expect(html).toContain(">Dismiss<");
    expect(html).not.toContain('disabled=""');
  });

  it("disables both buttons of the busy slot only", () => {
    const html = render([PRUNE, RULE], "pruneCommand");

    const button = (testId: string) => html.match(new RegExp(`<button[^>]*data-testid="${testId}"[^>]*>`))![0];
    expect(button("export-delegation-confirm-pruneCommand")).toContain('disabled=""');
    expect(button("export-delegation-dismiss-pruneCommand")).toContain('disabled=""');
    expect(button("export-delegation-confirm-reviewRule")).not.toContain('disabled=""');
    expect(button("export-delegation-dismiss-reviewRule")).not.toContain('disabled=""');
  });

  it("calls onConfirm and onDismiss with the slot when its buttons are clicked", () => {
    const onConfirm = vi.fn();
    const onDismiss = vi.fn();
    const tree = DelegationProposalList({
      proposals: [PRUNE, RULE],
      busySlot: null,
      onConfirm,
      onDismiss,
      t,
    });

    (byTestId(tree, "export-delegation-confirm-reviewRule").props.onClick as () => void)();
    expect(onConfirm).toHaveBeenCalledExactlyOnceWith("reviewRule");
    expect(onDismiss).not.toHaveBeenCalled();

    (byTestId(tree, "export-delegation-dismiss-pruneCommand").props.onClick as () => void)();
    expect(onDismiss).toHaveBeenCalledExactlyOnceWith("pruneCommand");
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });
});
