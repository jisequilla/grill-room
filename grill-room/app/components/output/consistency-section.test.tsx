import { AgentNativeI18nProvider } from "@agent-native/core/client/i18n";
import type { ReactElement, ReactNode } from "react";
import { renderToStaticMarkup as renderBare } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { i18nCatalog } from "@/i18n";

import {
  askedFindingIds,
  ConsistencyAskConfirm,
  ConsistencyAskOptions,
  type ConsistencyCard,
  ConsistencyCardsView,
  type ConsistencyList,
} from "@/components/output/consistency-section";

/** Renders with the app's English messages, as the page does. */
function renderToStaticMarkup(node: ReactNode): string {
  return renderBare(
    <AgentNativeI18nProvider catalog={i18nCatalog} initialLocale="en-US" persistPreference={false}>
      {node}
    </AgentNativeI18nProvider>,
  );
}

function aCard(number: number, overrides: Partial<ConsistencyCard> = {}): ConsistencyCard {
  return {
    id: `card-${number}`,
    number,
    kind: "unquantified-threshold",
    at: {
      artefact: "spec",
      section: "Implementation Decisions",
      ticket: null,
      quote: "must outlast the benchmark horizon",
    },
    against: null,
    question: `Question ${number}?`,
    decisionKey: null,
    status: "open",
    decision: null,
    ...overrides,
  };
}

function aList(overrides: Partial<ConsistencyList> = {}): ConsistencyList {
  return {
    findings: [aCard(1)],
    checked: true,
    current: true,
    askable: true,
    note: null,
    turnId: "turn-1",
    ...overrides,
  };
}

function render(
  list: ConsistencyList,
  { hasTickets = true, working = false, ticketsCurrent = true } = {},
): string {
  return renderToStaticMarkup(
    <ConsistencyCardsView
      list={list}
      hasTickets={hasTickets}
      ticketsCurrent={ticketsCurrent}
      working={working}
    />,
  );
}

/** The attribute a disabled button renders with, not the `disabled:` classes. */
const DISABLED = 'disabled=""';

/**
 * The markup from the opening tag carrying `data-testid` up to the next
 * element that carries one.
 */
function element(html: string, testId: string): string {
  const at = html.indexOf(`data-testid="${testId}"`);
  expect(at, `${testId} is rendered`).toBeGreaterThan(-1);
  const start = html.lastIndexOf("<", at);
  const next = html.indexOf("data-testid=", at + 1);
  const end = next === -1 ? html.length : html.lastIndexOf("<", next);
  return html.slice(start, end);
}

/** A card's whole markup, up to the next card. */
function cardOf(html: string, number: number): string {
  const at = html.indexOf(`data-testid="consistency-card-${number}"`);
  expect(at, `card ${number} is rendered`).toBeGreaterThan(-1);
  const start = html.lastIndexOf("<", at);
  const next = html.indexOf('data-testid="consistency-card-', at + 1);
  return html.slice(start, next === -1 ? html.length : html.lastIndexOf("<", next));
}

function asked(
  number: number,
  decision: ConsistencyCard["decision"],
): ConsistencyCard {
  return aCard(number, { status: "asked", decision });
}

const DECISION = { id: "d-1", key: "retention-horizon-1a2b3c4d" };

describe("ConsistencyCardsView", () => {
  it("renders nothing while the session has no tickets", () => {
    expect(render(aList(), { hasTickets: false })).not.toContain("consistency-section");
  });

  it("shows the note, not destructive, with the message, its code, and Check again", () => {
    const html = render(
      aList({
        findings: [],
        checked: false,
        current: false,
        askable: false,
        note: { code: "rate-limited", message: "The Claude subscription is rate limited right now." },
      }),
    );

    const note = element(html, "consistency-note");
    expect(note).toContain('data-error-code="rate-limited"');
    expect(note).toContain('role="alert"');
    expect(note).not.toContain("destructive");
    expect(note).toContain(">The consistency check did not run on these tickets<");
    expect(html).toContain("The Claude subscription is rate limited right now.");
    expect(html).toContain('data-testid="consistency-check-again"');
    expect(html).not.toContain('data-testid="consistency-unchecked"');
  });

  it("shows no Check again for a note of too many tickets", () => {
    const html = render(
      aList({
        findings: [],
        checked: false,
        current: false,
        askable: false,
        note: {
          code: "too-many-tickets",
          message: "The breakdown has 41 tickets; one consistency check covers at most 40, so the check was skipped.",
        },
      }),
    );

    expect(element(html, "consistency-note")).toContain('data-error-code="too-many-tickets"');
    expect(html).toContain("The breakdown has 41 tickets");
    expect(html).not.toContain('data-testid="consistency-check-again"');
  });

  it("shows unchecked tickets with Check again when no check was accepted and there is no note", () => {
    const html = render(aList({ findings: [], checked: false, current: false, askable: false }));

    expect(html).toContain('data-testid="consistency-unchecked"');
    expect(element(html, "consistency-unchecked")).toContain(">These tickets have not been checked.<");
    expect(html).toContain('data-testid="consistency-check-again"');
    expect(html).not.toContain('data-testid="consistency-none"');
  });

  it("says the check found nothing when it is current with no cards", () => {
    const html = render(aList({ findings: [] }));

    expect(html).toContain('data-testid="consistency-none"');
    expect(html).toContain("The consistency check found nothing the spec and tickets leave open.</div>");
    expect(html).not.toContain('data-testid="consistency-unchecked"');
    expect(html).not.toContain('data-testid="consistency-outdated"');
  });

  it("shows an open card's question, kind, places, source decision, and Answer and Dismiss", () => {
    const html = render(
      aList({
        findings: [
          aCard(4, {
            kind: "spec-ticket-contradiction",
            at: {
              artefact: "spec",
              section: "Implementation Decisions",
              ticket: null,
              quote: "Retention is a placeholder for a later ticket.",
            },
            against: { artefact: "ticket", section: null, ticket: 1, quote: "Fill in Retention" },
            question: "Does ticket 1 fill in Retention now?",
            decisionKey: "storage",
          }),
        ],
      }),
    );

    const card = cardOf(html, 4);
    expect(card).toContain('data-status="open"');
    expect(card).toContain("Does ticket 1 fill in Retention now?");
    expect(card).toContain("Retention is a placeholder for a later ticket.");
    expect(card).toContain("Fill in Retention");
    expect(card).toContain("From decision storage");
    expect(card).toContain("Spec and ticket disagree");
    expect(card).toContain("Spec · Implementation Decisions");
    expect(card).toContain("Ticket 1");
    expect(card).toContain('data-testid="consistency-answer-4"');
    expect(card).toContain('data-testid="consistency-dismiss-4"');
    expect(element(html, "consistency-answer-4")).not.toContain(DISABLED);
  });

  it("mutes a dismissed card, with no buttons", () => {
    const html = render(aList({ findings: [aCard(2, { status: "dismissed" })] }));

    const card = cardOf(html, 2);
    expect(card).toContain('data-status="dismissed"');
    expect(card).toContain("bg-muted");
    expect(card).toContain(">Dismissed</div>");
    expect(card).not.toContain("consistency-answer-2");
    expect(card).not.toContain("consistency-dismiss-2");
  });

  it.each<[string, ConsistencyCard["decision"], string]>([
    ["unplaced", { ...DECISION, state: "unplaced", answer: null }, "Waiting for the interview"],
    ["frontier", { ...DECISION, state: "frontier", answer: null }, "Waiting for the interview"],
    ["blocked", { ...DECISION, state: "blocked", answer: null }, "Waiting for the interview"],
    ["stale", { ...DECISION, state: "stale", answer: null }, "Waiting for the interview"],
    [
      "settled",
      { ...DECISION, state: "settled", answer: "Keep it 30 days after the benchmark ends." },
      "Answered: Keep it 30 days after the benchmark ends.",
    ],
    ["withdrawn", { ...DECISION, state: "withdrawn", answer: null }, "The interviewer withdrew this question"],
    ["gone", null, "The decision is gone"],
  ])("shows an asked card whose decision is %s", (_, decision, line) => {
    const html = render(aList({ findings: [asked(3, decision)] }));

    const card = cardOf(html, 3);
    expect(card).toContain('data-status="asked"');
    expect(card).not.toContain("consistency-answer-3");
    expect(card).not.toContain("consistency-dismiss-3");
    expect(card).toContain("Asked in the interview");
    expect(element(html, "consistency-decision-3")).toContain(`>${line}</p>`);
  });

  it("marks cards that are not current, and hides Answer and Dismiss unless they are askable", () => {
    const stillAskable = render(aList({ current: false, askable: true }));
    expect(element(stillAskable, "consistency-outdated")).toContain(
      ">These cards came from an earlier spec or breakdown.</p>",
    );
    expect(stillAskable).toContain('data-testid="consistency-answer-1"');

    const outdated = render(aList({ current: false, askable: false }));
    expect(outdated).toContain('data-testid="consistency-outdated"');
    expect(outdated).not.toContain('data-testid="consistency-answer-1"');
    expect(outdated).not.toContain('data-testid="consistency-dismiss-1"');
  });

  it("offers Check again when the check has not judged the current tickets and left no note", () => {
    const earlierCards = aList({ current: false, askable: false });
    const html = render(earlierCards);
    expect(element(html, "consistency-not-judged")).toContain(
      ">The consistency check has not judged these tickets.<",
    );
    expect(html).toContain('data-testid="consistency-check-again"');

    const noCards = render(aList({ findings: [], current: false, askable: false }));
    expect(noCards).toContain('data-testid="consistency-not-judged"');
    expect(noCards).toContain('data-testid="consistency-check-again"');

    // Not while the tickets are out of date (the check would be refused), nor
    // while the cards are askable, nor when the note already offers it.
    expect(render(earlierCards, { ticketsCurrent: false })).not.toContain("consistency-check-again");
    expect(render(aList({ current: false, askable: true }))).not.toContain("consistency-not-judged");
    const withNote = render(
      aList({ current: false, askable: false, note: { code: "rate-limited", message: "Later." } }),
    );
    expect(withNote).not.toContain("consistency-not-judged");
  });

  it("disables Answer, Dismiss and Check again while a turn is working", () => {
    const html = render(aList(), { working: true });
    expect(element(html, "consistency-answer-1")).toContain(DISABLED);
    expect(element(html, "consistency-dismiss-1")).toContain(DISABLED);

    const unchecked = render(aList({ findings: [], checked: false, current: false, askable: false }), {
      working: true,
    });
    expect(element(unchecked, "consistency-check-again")).toContain(DISABLED);
  });
});

describe("the ask dialog", () => {
  const cards = [
    aCard(1),
    aCard(2),
    aCard(3, { status: "dismissed" }),
    aCard(4, { status: "asked", decision: null }),
    aCard(5),
  ];

  it("lists every open card as a checkbox, the clicked one checked", () => {
    const html = renderToStaticMarkup(
      <ConsistencyAskOptions cards={cards} checked={new Set(["card-2"])} onToggle={() => {}} />,
    );

    for (const number of [1, 2, 5]) {
      expect(html).toContain(`data-testid="consistency-ask-option-${number}"`);
    }
    expect(html).not.toContain("consistency-ask-option-3");
    expect(html).not.toContain("consistency-ask-option-4");
    expect(element(html, "consistency-ask-option-2")).toContain('data-state="checked"');
    expect(element(html, "consistency-ask-option-1")).toContain('data-state="unchecked"');
  });

  it("sends exactly the checked open cards when the confirm is pressed", () => {
    const sent: string[][] = [];
    const button = ConsistencyAskConfirm({
      cards,
      checked: new Set(["card-5", "card-2", "card-3"]),
      disabled: false,
      label: "Ask 2 questions",
      pending: false,
      onConfirm: (findingIds) => sent.push(findingIds),
    }) as ReactElement<{ onClick: () => void; disabled: boolean }>;

    expect(button.props.disabled).toBe(false);
    button.props.onClick();
    expect(sent).toEqual([["card-2", "card-5"]]);

    const none = ConsistencyAskConfirm({
      cards,
      checked: new Set(),
      disabled: false,
      label: "Ask 0 questions",
      pending: false,
      onConfirm: () => {},
    }) as ReactElement<{ disabled: boolean }>;
    expect(none.props.disabled).toBe(true);
  });

  it("confirms exactly the checked open cards, in number order", () => {
    expect(askedFindingIds(cards, new Set(["card-5", "card-2"]))).toEqual(["card-2", "card-5"]);
    expect(askedFindingIds(cards, new Set())).toEqual([]);
    // A checked id that is no longer open is never sent.
    expect(askedFindingIds(cards, new Set(["card-3", "card-4", "card-1"]))).toEqual(["card-1"]);
  });
});
