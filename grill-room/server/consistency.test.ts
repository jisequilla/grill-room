import { describe, expect, it } from "vitest";

import {
  consistencyReasons,
  keepValidFindings,
  normaliseQuote,
  specSections,
  type ConsistencyFacts,
} from "./consistency.js";
import { consistencySpecMarkdown, consistencyTickets } from "./interviewer/fake.js";
import {
  checkConsistencyResultSchema,
  type ConsistencyFinding,
  type ConsistencyPlace,
  jsonSchemaFor,
  MAX_CONSISTENCY_FINDINGS,
} from "./interviewer/schemas.js";

const FIXTURE_FACTS: ConsistencyFacts = {
  specMarkdown: consistencySpecMarkdown(),
  tickets: consistencyTickets().map(({ number, title, body, waitsFor }) => ({
    number,
    title,
    body,
    waitsFor: waitsFor ?? null,
  })),
  settledKeys: ["storage"],
};

/** The fixture, with a gate ticket 5 whose words are only in its `waitsFor`. */
const GATE_FACTS: ConsistencyFacts = {
  ...FIXTURE_FACTS,
  tickets: [
    ...FIXTURE_FACTS.tickets,
    {
      number: 5,
      title: "Get an account",
      body: "The owner provides it.",
      waitsFor: "A staging account from the owner",
    },
  ],
};

/** A spec and a ticket holding none of the prompt task section's examples. */
const WORKSPACE_FACTS: ConsistencyFacts = {
  specMarkdown: [
    "## Problem Statement",
    "",
    "A settled idea.",
    "",
    "## Solution",
    "",
    "A workspace.",
    "",
    "## Implementation Decisions",
    "",
    "- The shape is a workspace.",
  ].join("\n"),
  tickets: [
    { number: 1, title: "Build the workspace", body: "Build the workspace shell.", waitsFor: null },
  ],
  settledKeys: [],
};

function inSpec(quote: string, section: string | null = "Implementation Decisions"): ConsistencyPlace {
  return { artefact: "spec", section, ticket: null, quote };
}

function inTicket(ticket: number | null, quote: string): ConsistencyPlace {
  return { artefact: "ticket", section: null, ticket, quote };
}

function aFinding(overrides: Partial<ConsistencyFinding> = {}): ConsistencyFinding {
  return {
    kind: "unquantified-threshold",
    at: inSpec("must outlast the benchmark horizon"),
    against: null,
    question: "How long after the benchmark ends must run data be kept?",
    decisionKey: null,
    ...overrides,
  };
}

const MISQUOTE = (quote: string, where: string) =>
  `Finding 1 quotes "${quote}", which is not in ${where}. Copy the words exactly as they are written there.`;

describe("specSections", () => {
  it("names the fixture spec's seven sections in order", () => {
    expect(specSections(consistencySpecMarkdown()).map((section) => section.name)).toEqual([
      "Problem Statement",
      "Solution",
      "User Stories",
      "Implementation Decisions",
      "Testing Decisions",
      "Out of Scope",
      "Further Notes",
    ]);
  });

  it("runs a section to the next level-1 or level-2 heading", () => {
    const sections = specSections(consistencySpecMarkdown());
    expect(sections.find((section) => section.name === "Solution")?.text).toBe(
      "\nA run store that keeps benchmark data, bookings and payments for the monitor.\n",
    );
    expect(
      specSections("## One\n\nfirst\n# Title\n\nafter\n## Two\n\nsecond").map((section) => [
        section.name,
        section.text,
      ]),
    ).toEqual([
      ["One", "\nfirst"],
      ["Two", "\nsecond"],
    ]);
  });

  it("keeps a repeated heading's first text", () => {
    const facts: ConsistencyFacts = {
      specMarkdown: "## Notes\n\nfirst\n\n## Notes\n\nsecond",
      tickets: [],
      settledKeys: [],
    };
    const quoting = (quote: string) =>
      consistencyReasons({ findings: [aFinding({ at: inSpec(quote, "Notes") })] }, facts);

    expect(quoting("first")).toEqual([[]]);
    expect(quoting("second")).toEqual([
      [MISQUOTE("second", `the spec's "Notes" section`)],
    ]);
    // The list of sections names it once.
    expect(
      consistencyReasons({ findings: [aFinding({ at: inSpec("first", "Other") })] }, facts),
    ).toEqual([
      ['Finding 1 names the spec section "Other", which the spec does not have. Its sections are: Notes.'],
    ]);
  });

  it("keeps a ### heading inside its section", () => {
    const sections = specSections("## Notes\n\n### Detail\n\ninside\n\n## After\n\nnext");
    expect(sections.map((section) => section.name)).toEqual(["Notes", "After"]);
    expect(sections[0]!.text).toBe("\n### Detail\n\ninside\n");
  });

  it("takes the heading text without its trailing spaces", () => {
    expect(specSections("##   Out of Scope  \n\n- x").map((section) => section.name)).toEqual([
      "Out of Scope",
    ]);
  });
});

describe("normaliseQuote", () => {
  it.each([
    ["must outlast the benchmark  horizon", "must outlast the benchmark horizon"],
    ["  horizon.\n- Retention\tis ", "horizon. - Retention is"],
    ["Case, And: punctuation.", "Case, And: punctuation."],
    ["   ", ""],
  ])("%j becomes %j", (text, expected) => {
    expect(normaliseQuote(text)).toBe(expected);
  });
});

describe("consistencyReasons", () => {
  it.each<[string, ConsistencyFinding[], ConsistencyFacts, string[][]]>([
    ["a spec quote in its section", [aFinding()], FIXTURE_FACTS, [[]]],
    [
      "a spec quote with two spaces (D5)",
      [aFinding({ at: inSpec("must outlast the benchmark  horizon") })],
      FIXTURE_FACTS,
      [[]],
    ],
    [
      "a spec quote spanning the end of one bullet and the start of the next (D5)",
      [aFinding({ at: inSpec("the benchmark horizon.\n- Retention is a placeholder") })],
      FIXTURE_FACTS,
      [[]],
    ],
    [
      "a spec quote with one word changed",
      [aFinding({ at: inSpec("must outlast the benchmark horizons") })],
      FIXTURE_FACTS,
      [[MISQUOTE("must outlast the benchmark horizons", `the spec's "Implementation Decisions" section`)]],
    ],
    [
      "a spec quote in another case",
      [aFinding({ at: inSpec("Must outlast the benchmark horizon") })],
      FIXTURE_FACTS,
      [[MISQUOTE("Must outlast the benchmark horizon", `the spec's "Implementation Decisions" section`)]],
    ],
    [
      "a spec quote from another section",
      [aFinding({ at: inSpec("must outlast the benchmark horizon", "Solution") })],
      FIXTURE_FACTS,
      [[MISQUOTE("must outlast the benchmark horizon", `the spec's "Solution" section`)]],
    ],
    [
      "a spec section the spec does not have",
      [aFinding({ at: inSpec("must outlast the benchmark horizon", "Implementation decisions") })],
      FIXTURE_FACTS,
      [
        [
          'Finding 1 names the spec section "Implementation decisions", which the spec does not have. Its sections are: Problem Statement, Solution, User Stories, Implementation Decisions, Testing Decisions, Out of Scope, Further Notes.',
        ],
      ],
    ],
    [
      "a whitespace-only spec quote",
      [aFinding({ at: inSpec("   ") })],
      FIXTURE_FACTS,
      [["Finding 1 has an empty quote."]],
    ],
    [
      "spec text with section null",
      [aFinding({ at: inSpec("must outlast the benchmark horizon", null) })],
      FIXTURE_FACTS,
      [["Finding 1: text in the spec needs `section` set and `ticket` null."]],
    ],
    [
      "spec text with a ticket set",
      [
        aFinding({
          at: { artefact: "spec", section: "Implementation Decisions", ticket: 2, quote: "nowhere at all" },
        }),
      ],
      FIXTURE_FACTS,
      [["Finding 1: text in the spec needs `section` set and `ticket` null."]],
    ],
    [
      "a ticket quote from its body",
      [aFinding({ at: inTicket(2, "capped at N x cadence") })],
      FIXTURE_FACTS,
      [[]],
    ],
    [
      "a mid-sentence ticket quote that keeps its capital",
      [aFinding({ kind: "open-choice", at: inTicket(3, "Checkout or Payment Element") })],
      FIXTURE_FACTS,
      [[]],
    ],
    [
      "the same mid-sentence quote lower-cased",
      [aFinding({ kind: "open-choice", at: inTicket(3, "checkout or Payment Element") })],
      FIXTURE_FACTS,
      [[MISQUOTE("checkout or Payment Element", "ticket 3")]],
    ],
    [
      "a ticket quote from its title",
      [aFinding({ kind: "open-choice", at: inTicket(3, "Take booking payments") })],
      FIXTURE_FACTS,
      [[]],
    ],
    [
      "a ticket quote from another ticket",
      [aFinding({ at: inTicket(3, "capped at N x cadence") })],
      FIXTURE_FACTS,
      [[MISQUOTE("capped at N x cadence", "ticket 3")]],
    ],
    [
      "a quote from a gate's waitsFor (D7)",
      [aFinding({ kind: "unnamed-target", at: inTicket(5, "A staging account from the owner") })],
      GATE_FACTS,
      [[]],
    ],
    [
      "a ticket not in the breakdown",
      [aFinding({ at: inTicket(7, "capped at N x cadence") })],
      FIXTURE_FACTS,
      [["Finding 1 names ticket 7, which is not in the breakdown. The tickets are 1-4."]],
    ],
    [
      "a ticket quote with one word changed",
      [aFinding({ at: inTicket(2, "capped at M x cadence") })],
      FIXTURE_FACTS,
      [[MISQUOTE("capped at M x cadence", "ticket 2")]],
    ],
    [
      "ticket text with ticket null",
      [aFinding({ at: inTicket(null, "capped at N x cadence") })],
      FIXTURE_FACTS,
      [["Finding 1: text in a ticket needs `ticket` set and `section` null."]],
    ],
    [
      "ticket text with a section set",
      [
        aFinding({
          at: { artefact: "ticket", section: "Solution", ticket: 2, quote: "capped at N x cadence" },
        }),
      ],
      FIXTURE_FACTS,
      [["Finding 1: text in a ticket needs `ticket` set and `section` null."]],
    ],
    [
      "a contradiction with no other side",
      [aFinding({ kind: "spec-ticket-contradiction", against: null })],
      FIXTURE_FACTS,
      [["Finding 1 is a spec-ticket-contradiction, so `against` must give the other side."]],
    ],
    [
      "an open choice with another side",
      [
        aFinding({
          kind: "open-choice",
          at: inTicket(3, "Checkout or Payment Element"),
          against: inSpec("must outlast the benchmark horizon"),
        }),
      ],
      FIXTURE_FACTS,
      [["Finding 1 is of kind open-choice, so `against` must be null."]],
    ],
    [
      "a contradiction with both sides in the spec",
      [
        aFinding({
          kind: "spec-ticket-contradiction",
          at: inSpec("Retention is a placeholder for a later ticket."),
          against: inSpec("must outlast the benchmark horizon"),
        }),
      ],
      FIXTURE_FACTS,
      [["Finding 1 must have one side in the spec and the other in a ticket."]],
    ],
    [
      "a contradiction with both sides in tickets",
      [
        aFinding({
          kind: "spec-ticket-contradiction",
          at: inTicket(1, "Fill in Retention"),
          against: inTicket(2, "capped at N x cadence"),
        }),
      ],
      FIXTURE_FACTS,
      [["Finding 1 must have one side in the spec and the other in a ticket."]],
    ],
    [
      "a contradiction with the ticket first",
      [
        aFinding({
          kind: "spec-ticket-contradiction",
          at: inTicket(1, "Fill in Retention"),
          against: inSpec("Retention is a placeholder for a later ticket."),
        }),
      ],
      FIXTURE_FACTS,
      [[]],
    ],
    ["a settled decision", [aFinding({ decisionKey: "storage" })], FIXTURE_FACTS, [[]]],
    [
      "a decision that is not settled in the tree",
      [aFinding({ decisionKey: "tone" })],
      FIXTURE_FACTS,
      [
        [
          'Finding 1 names decision "tone", which is not a settled decision of this tree. Give a settled decision\'s key, or null.',
        ],
      ],
    ],
    [
      "a statement for a question",
      [aFinding({ question: "Define the horizon." })],
      FIXTURE_FACTS,
      [['Finding 1\'s question must be one question to the owner, ending with "?".']],
    ],
    [
      "a question with a trailing space",
      [aFinding({ question: "How long?  " })],
      FIXTURE_FACTS,
      [[]],
    ],
    [
      "finding 3 repeating finding 1",
      [
        aFinding({ at: inSpec("must outlast the  benchmark horizon") }),
        aFinding({ at: inTicket(2, "capped at N x cadence") }),
        aFinding({ at: inSpec("must outlast the benchmark horizon"), question: "How long, again?" }),
      ],
      FIXTURE_FACTS,
      [[], [], ["Finding 3 repeats finding 1. Report each finding once."]],
    ],
    [
      "a contradiction repeated with its sides swapped",
      [
        aFinding({
          kind: "spec-ticket-contradiction",
          at: inSpec("Retention is a placeholder for a later ticket."),
          against: inTicket(1, "Fill in Retention"),
        }),
        aFinding({
          kind: "spec-ticket-contradiction",
          at: inTicket(1, "Fill in  Retention"),
          against: inSpec("Retention is a placeholder for a later ticket."),
          question: "Now or later?",
        }),
      ],
      FIXTURE_FACTS,
      [[], ["Finding 2 repeats finding 1. Report each finding once."]],
    ],
    [
      "two contradictions sharing a spec side but not a ticket side",
      [
        aFinding({
          kind: "spec-ticket-contradiction",
          at: inSpec("Retention is a placeholder for a later ticket."),
          against: inTicket(1, "Fill in Retention"),
        }),
        aFinding({
          kind: "spec-ticket-contradiction",
          at: inSpec("Retention is a placeholder for a later ticket."),
          against: inTicket(1, "delete run data once it is older than the retention window"),
          question: "Is the window set now?",
        }),
      ],
      FIXTURE_FACTS,
      [[], []],
    ],
    [
      "a finding with several faults",
      [
        aFinding({
          kind: "open-choice",
          at: inSpec("must outlast the benchmark horizons"),
          against: inTicket(2, "capped at M x cadence"),
          decisionKey: "tone",
          question: "Define the horizon.",
        }),
      ],
      FIXTURE_FACTS,
      [
        [
          MISQUOTE("must outlast the benchmark horizons", `the spec's "Implementation Decisions" section`),
          'Finding 1\'s `against` quotes "capped at M x cadence", which is not in ticket 2. Copy the words exactly as they are written there.',
          "Finding 1 is of kind open-choice, so `against` must be null.",
          'Finding 1 names decision "tone", which is not a settled decision of this tree. Give a settled decision\'s key, or null.',
          'Finding 1\'s question must be one question to the owner, ending with "?".',
        ],
      ],
    ],
    [
      "a quote found only in the prompt task section's own examples",
      [aFinding({ at: inTicket(1, "capped at N x cadence") })],
      WORKSPACE_FACTS,
      [[MISQUOTE("capped at N x cadence", "ticket 1")]],
    ],
  ])("%s", (_, findings, facts, expected) => {
    expect(consistencyReasons({ findings }, facts)).toEqual(expected);
  });

  it("names the other side as `against` in its reasons", () => {
    const reasons = consistencyReasons(
      {
        findings: [
          aFinding({
            kind: "spec-ticket-contradiction",
            at: inSpec("Retention is a placeholder for a later ticket."),
            against: inTicket(9, "Fill in Retention"),
          }),
        ],
      },
      FIXTURE_FACTS,
    );
    expect(reasons).toEqual([
      ["Finding 1's `against` names ticket 9, which is not in the breakdown. The tickets are 1-4."],
    ]);
  });
});

describe("the result schema's finding cap (D8)", () => {
  const findings = (count: number) =>
    Array.from({ length: count }, (_, index) => aFinding({ question: `Question ${index + 1}?` }));

  it(`accepts ${MAX_CONSISTENCY_FINDINGS} findings and refuses ${MAX_CONSISTENCY_FINDINGS + 1}`, () => {
    expect(MAX_CONSISTENCY_FINDINGS).toBe(20);
    expect(checkConsistencyResultSchema.safeParse({ findings: findings(20) }).success).toBe(true);
    expect(checkConsistencyResultSchema.safeParse({ findings: findings(21) }).success).toBe(false);
  });

  it("hands the command line a schema that caps findings at 20", () => {
    const schema = jsonSchemaFor("check-consistency") as {
      properties: { findings: { maxItems?: number } };
    };
    expect(schema.properties.findings.maxItems).toBe(20);
  });
});

describe("keepValidFindings", () => {
  it("keeps the findings with no reasons and names each dropped one", () => {
    const findings = [aFinding(), aFinding({ question: "Two?" }), aFinding({ question: "Three?" })];
    const kept = keepValidFindings({ findings }, [[], ["Reason a.", "Reason b."], []]);
    expect(kept.result.findings).toEqual([findings[0], findings[2]]);
    expect(kept.dropped).toBe(
      "Kept the valid findings after the last retry. Dropped finding 2 (Reason a. Reason b.).",
    );
  });

  it("joins several dropped findings with a semicolon", () => {
    const findings = [aFinding(), aFinding(), aFinding()];
    expect(keepValidFindings({ findings }, [["A."], [], ["B."]]).dropped).toBe(
      "Kept the valid findings after the last retry. Dropped finding 1 (A.); finding 3 (B.).",
    );
  });

  it("drops nothing when every finding is valid", () => {
    expect(keepValidFindings({ findings: [aFinding()] }, [[]]).dropped).toBeNull();
  });
});
