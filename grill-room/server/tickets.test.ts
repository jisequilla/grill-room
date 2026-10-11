import { describe, expect, it } from "vitest";

import { collisionKey } from "./brief-grounding.js";
import { breakIntoTicketsResultSchema } from "./interviewer/schemas.js";
import {
  chainLimit,
  chainReason,
  citability,
  computeWaves,
  longestChain,
  numberRanges,
  parseConsumes,
  parseImplements,
  parseProduces,
  parseUnproduced,
  separateOverlaps,
  unproducedInputs,
  unproducedNote,
  unproducedReason,
  unresolvedInputs,
  upstreamGaps,
  upstreamOf,
  userStories,
  type ConsumeSource,
  type ImplicitEdge,
  type InputGap,
  type ProposedTicket,
  type TicketConsume,
  type TicketForInputs,
  type TicketForSeparation,
  type TicketForWaves,
} from "./tickets.js";

function ticket(number: number, blockedBy: number[] = []): TicketForWaves {
  return { number, blockedBy };
}

describe("computeWaves", () => {
  it("puts a single ticket with no blockers in wave 1", () => {
    const result = computeWaves([ticket(1)]);
    expect(result).toEqual({ ok: true, waves: [[1]] });
  });

  it("puts independent tickets with no blockers all in wave 1, ordered by number", () => {
    const result = computeWaves([ticket(3), ticket(1), ticket(2)]);
    expect(result).toEqual({ ok: true, waves: [[1, 2, 3]] });
  });

  it("lays out a chain in one wave per link", () => {
    const result = computeWaves([
      ticket(1),
      ticket(2, [1]),
      ticket(3, [2]),
    ]);
    expect(result).toEqual({ ok: true, waves: [[1], [2], [3]] });
  });

  it("lays out a diamond: the join waits for every branch", () => {
    // 1 blocks 2 and 3; 4 is blocked by both 2 and 3.
    const result = computeWaves([
      ticket(1),
      ticket(2, [1]),
      ticket(3, [1]),
      ticket(4, [2, 3]),
    ]);
    expect(result).toEqual({ ok: true, waves: [[1], [2, 3], [4]] });
  });

  it("places a ticket in the earliest wave its blockers allow, not one wave per blocker chain length alone", () => {
    // 3 is blocked by both 1 (wave 1) and 2 (wave 2, since 2 is blocked by 1).
    // 3 must wait for the latest of its blockers, landing in wave 3.
    const result = computeWaves([
      ticket(1),
      ticket(2, [1]),
      ticket(3, [1, 2]),
    ]);
    expect(result).toEqual({ ok: true, waves: [[1], [2], [3]] });
  });

  it("is deterministic across repeated calls on the same input", () => {
    const tickets = [
      ticket(4, [2, 3]),
      ticket(1),
      ticket(3, [1]),
      ticket(2, [1]),
    ];
    const first = computeWaves(tickets);
    const second = computeWaves(tickets);
    expect(first).toEqual(second);
    expect(first).toEqual({ ok: true, waves: [[1], [2, 3], [4]] });
  });

  it("refuses a cycle, naming every ticket on it, instead of a partial wave list", () => {
    const result = computeWaves([
      ticket(1, [3]),
      ticket(2, [1]),
      ticket(3, [2]),
    ]);
    expect(result).toEqual({ ok: false, cycle: [1, 2, 3] });
  });

  it("names only the tickets on the cycle, not an unrelated ticket outside it", () => {
    const result = computeWaves([
      ticket(1, [2]),
      ticket(2, [1]),
      ticket(3),
    ]);
    expect(result).toEqual({ ok: false, cycle: [1, 2] });
  });

  it("ignores a blockedBy entry naming a ticket outside the set, as validation should already have refused it", () => {
    const result = computeWaves([ticket(1, [99])]);
    expect(result).toEqual({ ok: true, waves: [[1]] });
  });
});

describe("separateOverlaps", () => {
  function t(number: number, blockedBy: number[], files: string[]): TicketForSeparation {
    return { number, blockedBy, files };
  }
  function edge(ticket: number, waitsFor: number, sharedPaths: string[]): ImplicitEdge {
    return { ticket, waitsFor, sharedPaths };
  }

  it.each<[string, TicketForSeparation[], number[][], ImplicitEdge[]]>([
    ["1 (–; a), 2 (–; b)", [t(1, [], ["a"]), t(2, [], ["b"])], [[1, 2]], []],
    ["1 (–; a), 2 (–; a)", [t(1, [], ["a"]), t(2, [], ["a"])], [[1], [2]], [edge(2, 1, ["a"])]],
    [
      "1 (–; a), 2 (–; a), 3 (–; a)",
      [t(1, [], ["a"]), t(2, [], ["a"]), t(3, [], ["a"])],
      [[1], [2], [3]],
      [edge(2, 1, ["a"]), edge(3, 2, ["a"])],
    ],
    [
      "1 (–; a), 2 (–; b), 3 (1; c), 4 (–; b)",
      [t(1, [], ["a"]), t(2, [], ["b"]), t(3, [1], ["c"]), t(4, [], ["b"])],
      [[1, 2], [3, 4]],
      [edge(4, 2, ["b"])],
    ],
    ["1 (–; a, b), 2 (–; b, a)", [t(1, [], ["a", "b"]), t(2, [], ["b", "a"])], [[1], [2]], [edge(2, 1, ["a", "b"])]],
    ["1 (–; a), 2 (1; a): already ordered", [t(1, [], ["a"]), t(2, [1], ["a"])], [[1], [2]], []],
    [
      "1 (–; a), 2 (–; a), 3 (2; c): 3 moves with its blocker",
      [t(1, [], ["a"]), t(2, [], ["a"]), t(3, [2], ["c"])],
      [[1], [2], [3]],
      [edge(2, 1, ["a"])],
    ],
    [
      "1 (–; a), 2 (–; a, c), 3 (–; c): 3 shares nothing with 1, so it stays in wave 1",
      [t(1, [], ["a"]), t(2, [], ["a", "c"]), t(3, [], ["c"])],
      [[1, 3], [2]],
      [edge(2, 1, ["a"])],
    ],
    [
      "1 (–; a), 2 (–; a), 3 (–; b), 4 (–; a, b): 4 leaves wave 1 and then wave 2",
      [t(1, [], ["a"]), t(2, [], ["a"]), t(3, [], ["b"]), t(4, [], ["a", "b"])],
      [[1, 3], [2], [4]],
      [edge(2, 1, ["a"]), edge(4, 2, ["a"])],
    ],
    [
      "1 (–; a), 2 (–; b), 3 (–; a, b): one edge per partner",
      [t(1, [], ["a"]), t(2, [], ["b"]), t(3, [], ["a", "b"])],
      [[1, 2], [3]],
      [edge(3, 1, ["a"]), edge(3, 2, ["b"])],
    ],
    [
      "1 (4; a), 2 (–; d), 3 (2; a), 4 (–; c): visiting order 2, 3, 4, 1",
      [t(1, [4], ["a"]), t(2, [], ["d"]), t(3, [2], ["a"]), t(4, [], ["c"])],
      [[2, 4], [3], [1]],
      [edge(1, 3, ["a"])],
    ],
    [
      "a ticket with no grounded entry is treated as having no files",
      [t(1, [], ["a"]), t(2, [], [])],
      [[1, 2]],
      [],
    ],
  ])("%s", (_, tickets, waves, implicitEdges) => {
    expect(separateOverlaps(tickets, collisionKey)).toEqual({ ok: true, waves, implicitEdges });
  });

  it("compares files by collisionKey: a different case and a trailing slash are the same file", () => {
    const result = separateOverlaps(
      [t(1, [], ["server/Export.ts"]), t(2, [], ["server/export.ts/"])],
      collisionKey,
    );
    expect(result).toEqual({
      ok: true,
      waves: [[1], [2]],
      implicitEdges: [edge(2, 1, ["server/export.ts/"])],
    });
  });

  it("refuses a cycle, naming every ticket on it", () => {
    expect(separateOverlaps([t(1, [2], []), t(2, [1], []), t(3, [], [])], collisionKey)).toEqual({
      ok: false,
      cycle: [1, 2],
    });
  });
});

describe("userStories", () => {
  const section = (...lines: string[]) =>
    ["## Problem Statement", "", "Export it.", "", "## User Stories", "", ...lines, "", "## Implementation Decisions", "", "- One."].join("\n");

  it.each([
    [
      "numbered with a period",
      section("1. As a user, I want A, so that B.", "2. As a tester, I want C.", "3. As an owner, I want D."),
      [
        { number: 1, text: "As a user, I want A, so that B." },
        { number: 2, text: "As a tester, I want C." },
        { number: 3, text: "As an owner, I want D." },
      ],
    ],
    [
      "numbered with a parenthesis",
      section("1) As a user, I want A.", "2) As a user, I want B."),
      [
        { number: 1, text: "As a user, I want A." },
        { number: 2, text: "As a user, I want B." },
      ],
    ],
    [
      "with a nested, indented item",
      section("1. As a user, I want A.", "   1. a nested detail", "2. As a user, I want B."),
      [
        { number: 1, text: "As a user, I want A." },
        { number: 2, text: "As a user, I want B." },
      ],
    ],
    [
      "with a continuation line",
      section("1. As a user, I want A,", "   so that B."),
      [{ number: 1, text: "As a user, I want A," }],
    ],
    [
      "starting at 3",
      section("3. Three.", "4. Four.", "5. Five."),
      [
        { number: 3, text: "Three." },
        { number: 4, text: "Four." },
        { number: 5, text: "Five." },
      ],
    ],
    [
      "with a gap",
      section("1. One.", "2. Two.", "4. Four."),
      [
        { number: 1, text: "One." },
        { number: 2, text: "Two." },
        { number: 4, text: "Four." },
      ],
    ],
    [
      "with a repeated number",
      section("1. First", "1. Second", "1. Third"),
      [{ number: 1, text: "First" }],
    ],
    [
      "under a lowercase heading",
      "## user stories\n\n1. One.",
      [{ number: 1, text: "One." }],
    ],
    ["under a level-3 heading", "### User Stories\n\n1. One.", []],
    ["with no heading at all", "## Problem Statement\n\n1. One.", []],
    [
      "when the heading is followed directly by the next section",
      ["## Problem Statement", "## Solution", "## User Stories", "## Implementation Decisions", "## Testing Decisions"].join("\n\n"),
      [],
    ],
    [
      "stopping at the next level-2 heading",
      "## User Stories\n\n1. One.\n\n## Implementation Decisions\n\n2. Two.",
      [{ number: 1, text: "One." }],
    ],
    [
      "stopping at the next level-1 heading",
      "## User Stories\n\n1. One.\n\n# Appendix\n\n2. Two.",
      [{ number: 1, text: "One." }],
    ],
    [
      "past a level-3 subheading",
      "## User Stories\n\n1. One.\n\n### Admin\n\n2. Two.",
      [
        { number: 1, text: "One." },
        { number: 2, text: "Two." },
      ],
    ],
    ["with no space after the marker", section("10.No space"), []],
    ["written as bullets", section("- As a user, I want A.", "- As a user, I want B."), []],
    [
      "with Windows line endings",
      "## User Stories\r\n\r\n1. One.\r\n2. Two.",
      [
        { number: 1, text: "One." },
        { number: 2, text: "Two." },
      ],
    ],
  ])("reads stories %s", (_, markdown, expected) => {
    expect(userStories(markdown)).toEqual(expected);
  });
});

describe("numberRanges", () => {
  it.each([
    [[1, 2, 3, 5], "1-3, 5"],
    [[4], "4"],
    [[5, 4], "4-5"],
    [[1, 3, 3, 9, 10, 11], "1, 3, 9-11"],
  ])("writes %j as %s", (numbers, expected) => {
    expect(numberRanges(numbers)).toBe(expected);
  });
});

describe("parseImplements", () => {
  it.each<[string, string | null, number[] | null]>([
    ["a NULL column", null, null],
    ["an empty array", "[]", []],
    ["an array of story numbers", "[1,3]", [1, 3]],
    ["an array holding non-positive, fractional and non-number entries", '[0,-2,1.5,"4",null,5]', [5]],
    ["text that is not JSON", "not json", []],
    ["JSON that is not an array", '{"implements":[1]}', []],
  ])("reads %s", (_, json, expected) => {
    expect(parseImplements(json)).toEqual(expected);
  });
});

describe("longestChain", () => {
  type Row = { number: number; blockedBy: number[]; kind?: "build" | "gate" };
  const b = (number: number, blockedBy: number[] = []): Row => ({ number, blockedBy });
  const g = (number: number, blockedBy: number[] = []): Row => ({ number, blockedBy, kind: "gate" });

  it.each<[string, Row[], { ticket: number; waitsFor: number }[], { length: number; chain: number[] } | null]>([
    ["a straight chain", [b(1), b(2, [1]), b(3, [2])], [], { length: 3, chain: [1, 2, 3] }],
    ["aSource()'s shape", [b(1), b(2, [1]), b(3)], [], { length: 2, chain: [1, 2] }],
    ["a tie walks to the lowest number", [b(1), b(2), b(3, [1, 2])], [], { length: 2, chain: [1, 3] }],
    [
      "two branches joining",
      [b(1), b(2, [1]), b(3), b(4, [3]), b(5, [2, 4])],
      [],
      { length: 3, chain: [1, 2, 5] },
    ],
    ["no blockers", [b(1), b(2), b(3)], [], { length: 1, chain: [1] }],
    ["aSourceWithGate(): 1 is deeper than the gate", [b(1), g(2), b(3, [1, 2])], [], { length: 2, chain: [1, 3] }],
    [
      "aSourceWithGate({}, [1]): a tie at depth 1, the gate wins",
      [b(1), g(2, [1]), b(3, [1, 2])],
      [],
      { length: 2, chain: [1, 2, 3] },
    ],
    ["a gate first", [g(1), b(2, [1])], [], { length: 1, chain: [1, 2] }],
    ["the lowest build ticket at the greatest depth ends it", [b(1), g(2), b(3, [2])], [], { length: 1, chain: [1] }],
    ["only gates", [g(1), g(2, [1])], [], { length: 0, chain: [] }],
    ["an extra edge lengthens the chain", [b(1), b(2), b(3, [1])], [{ ticket: 2, waitsFor: 3 }], { length: 3, chain: [1, 3, 2] }],
    ["an out-of-set extra edge is ignored", [b(1), b(2)], [{ ticket: 2, waitsFor: 9 }], { length: 1, chain: [1] }],
    ["an out-of-set blocker is ignored", [b(1, [9])], [], { length: 1, chain: [1] }],
    ["a cycle", [b(1, [2]), b(2, [1])], [], null],
  ])("%s", (_, tickets, extraEdges, expected) => {
    expect(longestChain(tickets, extraEdges)).toEqual(expected);
  });
});

describe("chainLimit and chainReason", () => {
  it.each([
    [1, 4],
    [8, 4],
    [9, 5],
    [10, 5],
    [23, 12],
    [5, 4],
  ])("chainLimit(%i) is %i", (builds, limit) => {
    expect(chainLimit(builds)).toBe(limit);
  });

  function proposed(number: number, blockedBy: number[] = [], kind: "build" | "gate" = "build"): ProposedTicket {
    return {
      number,
      slug: `ticket-${number}`,
      title: `Ticket ${number}`,
      body: "Build it.",
      blockedBy,
      kind,
      waitsFor: kind === "gate" ? "An account." : null,
      implements: [],
    };
  }

  const TAIL =
    "List a ticket in `blockedBy` only when it uses that ticket's output, and give a file that many tickets change its own early ticket, so more tickets can be built side by side.";

  it.each<[string, ProposedTicket[], string | null]>([
    [
      "six build tickets in one chain",
      [proposed(1), proposed(2, [1]), proposed(3, [2]), proposed(4, [3]), proposed(5, [4]), proposed(6, [5])],
      `The longest chain of tickets that must be built one after another is 6 build tickets (1 → 2 → 3 → 4 → 5 → 6), in a set of 6 build tickets; keep it to 4 or fewer. ${TAIL}`,
    ],
    [
      "five build tickets chained through gate 6",
      [proposed(1), proposed(6, [1], "gate"), proposed(2, [6]), proposed(3, [2]), proposed(4, [3]), proposed(5, [4])],
      `The longest chain of tickets that must be built one after another is 5 build tickets (1 → gate 6 → 2 → 3 → 4 → 5), in a set of 5 build tickets; keep it to 4 or fewer. ${TAIL}`,
    ],
    [
      "six build tickets, chain 4",
      [proposed(1), proposed(2, [1]), proposed(3, [2]), proposed(4, [3]), proposed(5), proposed(6)],
      null,
    ],
    [
      "the recorded demo's shape, chain 4 in 5",
      [proposed(1), proposed(2, [1]), proposed(3, [2]), proposed(4, [1]), proposed(5, [3])],
      null,
    ],
    ["a cycle", [proposed(1, [2]), proposed(2, [1])], null],
  ])("%s", (_, tickets, expected) => {
    expect(chainReason(tickets)).toBe(expected);
  });

  it("keeps a chain at the limit and sends back one over it, for 23 build tickets", () => {
    const chained = (length: number) =>
      Array.from({ length: 23 }, (_, index) =>
        proposed(index + 1, index > 0 && index < length ? [index] : []),
      );
    expect(chainReason(chained(12))).toBeNull();
    expect(chainReason(chained(13))).toContain("is 13 build tickets");
    expect(chainReason(chained(13))).toContain("in a set of 23 build tickets; keep it to 12 or fewer.");
  });
});

describe("citability", () => {
  const settled = (kind: string, overrides: Record<string, unknown> = {}) =>
    ({
      state: "settled",
      answer: { text: "An answer", kind },
      replacedBy: null,
      ...overrides,
    }) as unknown as Parameters<typeof citability>[0];

  it.each(["accepted-recommendation", "own-answer", "repo-established"])(
    "calls a settled %s answer citable",
    (kind) => {
      expect(citability(settled(kind))).toBe("citable");
    },
  );

  it.each(["dispositioned", "deferred", "unknown", "pushed-back", "prototype-flagged"])(
    "calls a settled %s answer not settled",
    (kind) => {
      expect(citability(settled(kind))).toBe("not-settled");
    },
  );

  it.each(["open", "blocked", "stale", "withdrawn", "unplaced"])("calls a %s decision not settled", (state) => {
    expect(citability(settled("own-answer", { state }))).toBe("not-settled");
  });

  it("calls a settled decision with no answer not settled", () => {
    expect(citability(settled("own-answer", { answer: null }))).toBe("not-settled");
  });

  it("calls a replaced decision replaced", () => {
    expect(citability(settled("own-answer", { replacedBy: { id: "d-2" } }))).toBe("replaced");
  });

  it("calls an unsettled decision that was replaced not settled", () => {
    expect(citability(settled("deferred", { replacedBy: { id: "d-2" } }))).toBe("not-settled");
  });
});

type Io = TicketForInputs;
const consume = (item: string, from: ConsumeSource): TicketConsume => ({ item, from });
const build = (
  number: number,
  blockedBy: number[] = [],
  consumes?: TicketConsume[],
  produces?: string[],
): Io => ({ number, kind: "build", blockedBy, consumes, produces });
const gate = (
  number: number,
  blockedBy: number[] = [],
  produces?: string[],
  consumes?: TicketConsume[],
): Io => ({ number, kind: "gate", blockedBy, consumes, produces });
const gap = (
  ticket: number,
  item: string,
  from: ConsumeSource,
  reason: InputGap["reason"],
): InputGap => ({ ticket, item, from, reason });
const tracked = (files: string[], omitted = 0) => ({ files, omitted });

describe("upstreamOf", () => {
  it("walks blockedBy transitively", () => {
    expect(upstreamOf([build(1), build(2, [1]), build(3, [2])], 3)).toEqual(new Set([1, 2]));
  });

  const readLimited = (number: number, blockedBy: number[]) => {
    let reads = 0;
    return {
      number,
      get blockedBy() {
        if (++reads > 50) throw new Error("upstreamOf kept walking a cycle");
        return blockedBy;
      },
    };
  };

  it("terminates on a cycle through the start", () => {
    expect(upstreamOf([readLimited(2, [3]), readLimited(3, [2])], 3)).toEqual(new Set([2]));
  });

  it("terminates on a cycle that avoids the start", () => {
    expect(
      upstreamOf([readLimited(1, [2]), readLimited(2, [1]), readLimited(3, [1])], 3),
    ).toEqual(new Set([1, 2]));
  });

  it("skips numbers that are not in the set", () => {
    expect(upstreamOf([build(3, [9])], 3)).toEqual(new Set());
  });

  it("never includes the start, even when it blocks itself", () => {
    expect(upstreamOf([build(3, [3])], 3)).toEqual(new Set());
  });

  it("passes through a gate", () => {
    expect(upstreamOf([build(1), gate(2, [1]), build(3, [2])], 3)).toEqual(new Set([1, 2]));
  });
});

describe("unproducedInputs", () => {
  it.each<[string, Io[], { files: string[]; omitted: number } | null, InputGap[]]>([
    [
      "no source",
      [build(1, [], [consume("spans writer", null)])],
      null,
      [gap(1, "spans writer", null, "no-source")],
    ],
    [
      "produced by a blocker",
      [build(1, [], [], ["gr_spans table"]), build(2, [1], [consume("gr_spans table", 1)])],
      null,
      [],
    ],
    [
      "item normalized (case, whitespace runs)",
      [build(1, [], [], ["gr_spans table"]), build(2, [1], [consume("GR_SPANS  Table", 1)])],
      null,
      [],
    ],
    [
      "produces side normalized",
      [build(1, [], [], ["  GR_SPANS   Table "]), build(2, [1], [consume("gr_spans table", 1)])],
      null,
      [],
    ],
    [
      "only ticket `from`'s produces counts",
      [build(1, [], [], ["a"]), build(2, [], [], ["b"]), build(3, [1, 2], [consume("b", 1)])],
      null,
      [gap(3, "b", 1, "not-produced")],
    ],
    [
      "transitively upstream",
      [build(1, [], [], ["x"]), build(2, [1]), build(3, [2], [consume("x", 1)])],
      null,
      [],
    ],
    [
      "upstream through a gate",
      [build(1, [], [], ["x"]), gate(2, [1]), build(3, [2], [consume("x", 1)])],
      null,
      [],
    ],
    [
      "ticket order is ascending number, not array order",
      [
        build(2, [], [consume("b", null)]),
        build(1, [], [consume("a", null)]),
      ],
      null,
      [gap(1, "a", null, "no-source"), gap(2, "b", null, "no-source")],
    ],
    [
      "the source does not produce it",
      [build(1, [], [], ["gr_runs table"]), build(2, [1], [consume("gr_spans table", 1)])],
      null,
      [gap(2, "gr_spans table", 1, "not-produced")],
    ],
    [
      "no such ticket",
      [build(1, [], [consume("x", 9)])],
      null,
      [gap(1, "x", 9, "unknown-ticket")],
    ],
    [
      "itself as the source",
      [build(1), build(2), build(3, [], [consume("x", 3)], ["x"])],
      null,
      [gap(3, "x", 3, "unknown-ticket")],
    ],
    [
      "produced but not upstream",
      [build(1, [], [], ["gr_spans table"]), build(2, [], [consume("gr_spans table", 1)])],
      null,
      [gap(2, "gr_spans table", 1, "not-upstream")],
    ],
    [
      "a gate's produces counts as a source",
      [gate(1, [], ["Stripe test account"]), build(2, [1], [consume("Stripe test account", 1)])],
      null,
      [],
    ],
    [
      "a gate's consumes is not checked",
      [build(1), gate(2, [1], [], [consume("x", null)]), build(3, [2])],
      null,
      [],
    ],
    [
      "repo path tracked",
      [build(1, [], [consume("server/db/schema.ts", "repo")])],
      tracked(["server/db/schema.ts"]),
      [],
    ],
    [
      "repo path with a leading ./",
      [build(1, [], [consume("./server/db/schema.ts", "repo")])],
      tracked(["server/db/schema.ts"]),
      [],
    ],
    [
      "repo path is case-sensitive",
      [build(1, [], [consume("Server/DB/schema.ts", "repo")])],
      tracked(["server/db/schema.ts"]),
      [gap(1, "Server/DB/schema.ts", "repo", "not-tracked")],
    ],
    [
      "repo path not tracked",
      [build(1, [], [consume("server/spans.ts", "repo")])],
      tracked(["server/db/schema.ts"]),
      [gap(1, "server/spans.ts", "repo", "not-tracked")],
    ],
    [
      "repo non-file thing is trusted",
      [build(1, [], [consume("gr_sessions table", "repo")])],
      tracked(["server/db/schema.ts"]),
      [],
    ],
    [
      "repo root file name with an extension but no slash is trusted",
      [build(1, [], [consume("justfile.md", "repo")])],
      tracked([]),
      [],
    ],
    [
      "repo field with a dot but no slash is trusted",
      [build(1, [], [consume("gr_tickets.consumes", "repo")])],
      tracked([]),
      [],
    ],
    [
      "repo endpoint without an extension is trusted",
      [build(1, [], [consume("api/sessions", "repo")])],
      tracked([]),
      [],
    ],
    [
      "repo folder is trusted",
      [build(1, [], [consume("server/db/", "repo")])],
      tracked([]),
      [],
    ],
    [
      "repo path with a leading slash is trusted",
      [build(1, [], [consume("/server/db/schema.ts", "repo")])],
      tracked([]),
      [],
    ],
    [
      "repo path trimmed before matching",
      [build(1, [], [consume("  server/db/schema.ts ", "repo")])],
      tracked(["server/db/schema.ts"]),
      [],
    ],
    [
      "repo path trimmed before the shape check",
      [build(1, [], [consume("  server/spans.ts ", "repo")])],
      tracked([]),
      [gap(1, "server/spans.ts", "repo", "not-tracked")],
    ],
    [
      "item side trimmed",
      [build(1, [], [], ["gr_spans table"]), build(2, [1], [consume(" gr_spans table ", 1)])],
      null,
      [],
    ],
    [
      "repo path with a colon is trusted",
      [build(1, [], [consume("server/a:b.ts", "repo")])],
      tracked([]),
      [],
    ],
    [
      "repo path with whitespace is trusted",
      [build(1, [], [consume("server/my file.ts", "repo")])],
      tracked([]),
      [],
    ],
    [
      "repo ./package.json has no inner slash and is trusted",
      [build(1, [], [consume("./package.json", "repo")])],
      tracked([]),
      [],
    ],
    [
      "unknown-ticket wins over not-produced",
      [build(1), build(2), build(3, [], [consume("y", 3)], ["x"])],
      null,
      [gap(3, "y", 3, "unknown-ticket")],
    ],
    [
      "duplicate numbers are not checked, even for no-source",
      [build(1), build(1), build(2, [], [consume("x", null)])],
      null,
      [],
    ],
    [
      "an empty tracked list still counts as a list",
      [build(1, [], [consume("server/spans.ts", "repo")])],
      tracked([]),
      [gap(1, "server/spans.ts", "repo", "not-tracked")],
    ],
    [
      "api/v1.2 reads as having an extension",
      [build(1, [], [consume("api/v1.2", "repo")])],
      tracked([]),
      [gap(1, "api/v1.2", "repo", "not-tracked")],
    ],
    ["an item empty after trimming is skipped", [build(1, [], [consume(" ", null)])], null, []],
    [
      "a gate is upstream only through blockedBy",
      [gate(1, [], ["Stripe test account"]), build(2, [], [consume("Stripe test account", 1)])],
      null,
      [gap(2, "Stripe test account", 1, "not-upstream")],
    ],
    [
      "the same entry twice is two gaps",
      [build(1, [], [consume("x", null), consume("x", null)])],
      null,
      [gap(1, "x", null, "no-source"), gap(1, "x", null, "no-source")],
    ],
    [
      "a null source is a gap even when another ticket produces the item",
      [
        build(1, [], [], ["x"]),
        build(2, [1], [consume("x", 1), consume("x", null)]),
      ],
      null,
      [gap(2, "x", null, "no-source")],
    ],
    ["no consumes field at all", [build(1)], null, []],
    [
      "repo path missing from a cut list cannot be told",
      [build(1, [], [consume("server/spans.ts", "repo")])],
      tracked(["server/db/schema.ts"], 3),
      [],
    ],
    [
      "repo path with no tracked list cannot be told",
      [build(1, [], [consume("anything/else.ts", "repo")])],
      null,
      [],
    ],
  ])("%s", (_, tickets, trackedFiles, expected) => {
    expect(unproducedInputs(tickets, trackedFiles)).toEqual(expected);
  });

  it("first applicable reason wins", () => {
    const tickets = [build(1, [], [], ["a"]), build(2, [], [consume("b", 1)])];

    expect(unproducedInputs(tickets, null)).toEqual([gap(2, "b", 1, "not-produced")]);
  });

  it("gaps come in consumes order, whatever the reason", () => {
    const tickets = [
      build(1, [], [], ["a"]),
      build(2, [], [consume("a", 1), consume("b", null)]),
    ];

    expect(unproducedInputs(tickets, null)).toEqual([
      gap(2, "a", 1, "not-upstream"),
      gap(2, "b", null, "no-source"),
    ]);
  });

  it("a gate's consumes is not checked", () => {
    expect(
      unproducedInputs([build(1), gate(2, [1], [], [consume("x", null)]), build(3, [2])], null),
    ).toEqual([]);
  });
});

describe("upstreamGaps", () => {
  it("returns a consumed item whose producer is not upstream", () => {
    const tickets = [build(1, [], [], ["a"]), build(2, [], [consume("a", 1)])];

    expect(upstreamGaps(tickets)).toEqual([gap(2, "a", 1, "not-upstream")]);
  });

  it("loses the gap once the producer blocks the consumer", () => {
    const tickets = [build(1, [], [], ["a"]), build(2, [1], [consume("a", 1)])];

    expect(upstreamGaps(tickets)).toEqual([]);
  });

  it("reads null consumes and undefined produces as empty", () => {
    const tickets: Io[] = [
      { number: 1, kind: "build", blockedBy: [], produces: undefined },
      { number: 2, kind: "build", blockedBy: [], consumes: null },
    ];

    expect(upstreamGaps(tickets)).toEqual([]);
  });

  it("skips a gate's consumes", () => {
    expect(upstreamGaps([build(1, [], [], ["a"]), gate(2, [], [], [consume("a", 1)])])).toEqual([]);
  });

  it("does not check a set with duplicate numbers", () => {
    const tickets = [
      build(1, [], [], ["a"]),
      build(1, [], [], ["a"]),
      build(2, [], [consume("a", 1)]),
    ];

    expect(upstreamGaps(tickets)).toEqual([]);
  });

  it("leaves out an entry that is not produced", () => {
    expect(upstreamGaps([build(1, [], [], ["a"]), build(2, [], [consume("b", 1)])])).toEqual([]);
  });
});

describe("parseConsumes / parseProduces / parseUnproduced", () => {
  it.each([
    ["oops", []],
    ["{}", []],
    ['[{"item":"a","from":null},{"item":5}]', [{ item: "a", from: null }]],
    ['[{"item":"a"}]', []],
    ['[{"item":"a","from":"x"}]', []],
    ['[{"item":"a","from":"repo"}]', [{ item: "a", from: "repo" }]],
    ['[{"item":"","from":null}]', []],
    ['[{"item":" ","from":null}]', []],
    ['[{"item":"a","from":0}]', []],
    ['[{"item":"a","from":1.5}]', []],
    ['[{"item":"a","from":2}]', [{ item: "a", from: 2 }]],
  ])("parseConsumes %j", (json, expected) => {
    expect(parseConsumes(json)).toEqual(expected);
  });

  it("parseConsumes reads a NULL column as null", () => {
    expect(parseConsumes(null)).toBeNull();
  });

  it("parseProduces keeps the non-blank strings", () => {
    expect(parseProduces('["a",""," ",5]')).toEqual(["a"]);
    expect(parseProduces("oops")).toEqual([]);
    expect(parseProduces(null)).toBeNull();
  });

  it.each([
    [
      '[{"item":"a","from":"repo","reason":"not-tracked"}]',
      [{ item: "a", from: "repo", reason: "not-tracked" }],
    ],
    ['[{"item":"a","from":null,"reason":"bogus"}]', []],
    ['[{"item":" ","from":null,"reason":"no-source"}]', []],
    ['[{"item":"a","from":"repo"}]', []],
    ["{}", []],
  ])("parseUnproduced %j", (json, expected) => {
    expect(parseUnproduced(json)).toEqual(expected);
  });

  it("parseUnproduced reads a NULL column as null", () => {
    expect(parseUnproduced(null)).toBeNull();
  });
});

describe("unproducedReason / unproducedNote", () => {
  const HEAD =
    'Some tickets consume inputs that are unresolved. For each line, add a ticket that produces it, name the ticket that does in `from` (it must be upstream through `blockedBy`), copy that ticket\'s `produces` wording exactly, or, for a file that exists, use `"repo"` with its tracked path:';

  it("says no source", () => {
    expect(unproducedReason([gap(4, "spans writer", null, "no-source")])).toBe(
      `${HEAD}\n- ticket 4 consumes "spans writer" (from: null): no source`,
    );
  });

  it("says the source does not produce it", () => {
    expect(unproducedReason([gap(5, "gr_spans table", 1, "not-produced")])).toBe(
      `${HEAD}\n- ticket 5 consumes "gr_spans table" (from: 1): ticket 1 does not produce it`,
    );
  });

  it("says there is no such ticket", () => {
    expect(unproducedReason([gap(6, "x", 9, "unknown-ticket")])).toBe(
      `${HEAD}\n- ticket 6 consumes "x" (from: 9): no ticket 9`,
    );
  });

  it("says a ticket cannot be its own source", () => {
    expect(unproducedReason([gap(3, "x", 3, "unknown-ticket")])).toBe(
      `${HEAD}\n- ticket 3 consumes "x" (from: 3): no ticket 3 other than ticket 3 itself`,
    );
  });

  it("says the source is not upstream", () => {
    expect(unproducedReason([gap(7, "gr_spans table", 1, "not-upstream")])).toBe(
      `${HEAD}\n- ticket 7 consumes "gr_spans table" (from: 1): ticket 1 is not upstream of ticket 7`,
    );
  });

  it("says a file is not tracked", () => {
    expect(unproducedReason([gap(8, "server/spans.ts", "repo", "not-tracked")])).toBe(
      `${HEAD}\n- ticket 8 consumes "server/spans.ts" (from: "repo"): not a tracked file`,
    );
  });

  it("escapes quotes in an item", () => {
    expect(unproducedReason([gap(1, 'a "b"', null, "no-source")])).toBe(
      `${HEAD}\n- ticket 1 consumes "a \\"b\\"" (from: null): no source`,
    );
    expect(unproducedNote([gap(1, 'a "b"', null, "no-source")])).toBe(
      'Accepted with 1 unresolved input: ticket 1 "a \\"b\\"" (no source).',
    );
  });

  it("counts one unresolved input and several", () => {
    expect(unproducedNote([gap(4, "spans writer", null, "no-source")])).toBe(
      'Accepted with 1 unresolved input: ticket 4 "spans writer" (no source).',
    );
    expect(
      unproducedNote([
        gap(4, "spans writer", null, "no-source"),
        gap(7, "gr_spans table", 1, "not-upstream"),
      ]),
    ).toBe(
      'Accepted with 2 unresolved inputs: ticket 4 "spans writer" (no source), ticket 7 "gr_spans table" (ticket 1 is not upstream of ticket 7).',
    );
  });

  it("has no note without gaps", () => {
    expect(unproducedNote([])).toBeNull();
  });
});

describe("consumes/produces seam: every shape the prompt describes", () => {
  const ticket = (extra: Record<string, unknown>) => ({
    slug: "t",
    title: "T",
    body: "",
    blockedBy: [],
    ...extra,
  });
  const listed = tracked(["server/db/schema.ts"]);

  it.each<[string, Record<string, unknown>[], InputGap[]]>([
    [
      "a ticket-number source that is upstream",
      [
        ticket({ number: 1, produces: ["gr_spans table"] }),
        ticket({ number: 2, blockedBy: [1], consumes: [{ item: "gr_spans table", from: 1 }] }),
      ],
      [],
    ],
    [
      "repo with a tracked path",
      [ticket({ number: 1, consumes: [{ item: "server/db/schema.ts", from: "repo" }] })],
      [],
    ],
    [
      "repo with an untracked path",
      [ticket({ number: 1, consumes: [{ item: "server/spans.ts", from: "repo" }] })],
      [gap(1, "server/spans.ts", "repo", "not-tracked")],
    ],
    [
      "repo with non-path items",
      [
        ticket({
          number: 1,
          consumes: [
            "gr_sessions table",
            "gr_tickets.consumes",
            "api/sessions",
            "server/db/",
            "/server/db/schema.ts",
          ].map((item) => ({ item, from: "repo" })),
        }),
      ],
      [],
    ],
    [
      "null",
      [ticket({ number: 1, consumes: [{ item: "spans writer", from: null }] })],
      [gap(1, "spans writer", null, "no-source")],
    ],
    [
      "a gate with produces and empty consumes",
      [
        ticket({ number: 1, kind: "gate", waitsFor: "An account", produces: ["Stripe account"] }),
        ticket({ number: 2, blockedBy: [1], consumes: [{ item: "Stripe account", from: 1 }] }),
      ],
      [],
    ],
    ["a ticket with both lists empty", [ticket({ number: 1, consumes: [], produces: [] })], []],
  ])("%s", (_, raw, expected) => {
    const parsed = breakIntoTicketsResultSchema.parse({ tickets: raw });

    expect(unproducedInputs(parsed.tickets, listed)).toEqual(expected);
  });
});

describe("unresolvedInputs (stored gaps plus recomputed not-upstream)", () => {
  type Stored = Omit<InputGap, "ticket">;
  type Row = Parameters<typeof unresolvedInputs>[0][number];
  const stored = (item: string, from: ConsumeSource, reason: InputGap["reason"]): Stored => ({
    item,
    from,
    reason,
  });
  const row = (
    number: number,
    fields: Partial<Omit<Row, "number">> = {},
  ): Row => ({
    number,
    kind: "build",
    blockedBy: [],
    consumes: [],
    produces: [],
    unproduced: [],
    ...fields,
  });

  it("is null when a build ticket has consumes null", () => {
    const tickets = [
      row(1, { consumes: null, unproduced: null }),
      row(2, { consumes: [consume("a", null)], unproduced: [stored("a", null, "no-source")] }),
    ];

    expect(unresolvedInputs(tickets)).toBeNull();
  });

  it("is null when a gate has consumes null", () => {
    const tickets = [
      row(1, { kind: "gate", consumes: null }),
      row(2, { consumes: [consume("a", null)], unproduced: [stored("a", null, "no-source")] }),
    ];

    expect(unresolvedInputs(tickets)).toBeNull();
  });

  it("checks null before the duplicate-number guard", () => {
    expect(unresolvedInputs([row(1, { consumes: null }), row(3), row(3)])).toBeNull();
  });

  it("is not null for a null produces, and recomputes no not-upstream from it", () => {
    const tickets = [
      row(1),
      row(3, {
        blockedBy: [1],
        consumes: [consume("x", 4)],
        unproduced: [stored("x", 4, "not-produced")],
      }),
      row(4, { produces: null }),
    ];

    expect(unresolvedInputs(tickets)).toEqual([gap(3, "x", 4, "not-produced")]);
  });

  it("is empty when nothing is unresolved", () => {
    expect(unresolvedInputs([row(1), row(2)])).toEqual([]);
  });

  it("returns a stored gap with its ticket number", () => {
    const tickets = [
      row(1),
      row(2, {
        consumes: [consume("spans writer", null)],
        unproduced: [stored("spans writer", null, "no-source")],
      }),
    ];

    expect(unresolvedInputs(tickets)).toEqual([gap(2, "spans writer", null, "no-source")]);
  });

  it("recomputes not-upstream from blockedBy", () => {
    const base = (blockedBy: number[]) => [
      row(1),
      row(3, { blockedBy, consumes: [consume("gr_spans table", 4)] }),
      row(4, { produces: ["gr_spans table"] }),
    ];

    expect(unresolvedInputs(base([1]))).toEqual([gap(3, "gr_spans table", 4, "not-upstream")]);
    expect(unresolvedInputs(base([4]))).toEqual([]);
  });

  it("orders a ticket's gaps by consumes: recomputed first", () => {
    const tickets = [
      row(1),
      row(3, {
        blockedBy: [1],
        consumes: [consume("gr_spans table", 4), consume("spans writer", null)],
        unproduced: [stored("spans writer", null, "no-source")],
      }),
      row(4, { produces: ["gr_spans table"] }),
    ];

    expect(unresolvedInputs(tickets)).toEqual([
      gap(3, "gr_spans table", 4, "not-upstream"),
      gap(3, "spans writer", null, "no-source"),
    ]);
  });

  it("orders a ticket's gaps by consumes: stored first", () => {
    const tickets = [
      row(1),
      row(3, {
        blockedBy: [1],
        consumes: [consume("spans writer", null), consume("gr_spans table", 4)],
        unproduced: [stored("spans writer", null, "no-source")],
      }),
      row(4, { produces: ["gr_spans table"] }),
    ];

    expect(unresolvedInputs(tickets)).toEqual([
      gap(3, "spans writer", null, "no-source"),
      gap(3, "gr_spans table", 4, "not-upstream"),
    ]);
  });

  it("matches a stored gap on item and from", () => {
    const tickets = [
      row(1),
      row(3, {
        blockedBy: [5],
        consumes: [consume("x", 5), consume("x", 4), consume("x", null)],
        unproduced: [stored("x", null, "no-source")],
      }),
      row(4, { produces: ["x"] }),
      row(5, { produces: ["x"] }),
    ];

    expect(unresolvedInputs(tickets)).toEqual([
      gap(3, "x", 4, "not-upstream"),
      gap(3, "x", null, "no-source"),
    ]);
  });

  it("matches a stored gap on the trimmed entry", () => {
    const tickets = [
      row(1),
      row(3, {
        blockedBy: [1],
        consumes: [consume("gr_spans table", 4), consume(" x ", null)],
        unproduced: [stored("zz", null, "no-source"), stored("x", null, "no-source")],
      }),
      row(4, { produces: ["gr_spans table"] }),
    ];

    expect(unresolvedInputs(tickets)).toEqual([
      gap(3, "gr_spans table", 4, "not-upstream"),
      gap(3, "x", null, "no-source"),
      gap(3, "zz", null, "no-source"),
    ]);
  });

  it("drops a stored not-upstream gap", () => {
    const tickets = [
      row(3, {
        blockedBy: [4],
        consumes: [consume("a", 4)],
        unproduced: [stored("a", 4, "not-upstream")],
      }),
      row(4, { produces: ["a"] }),
    ];

    expect(unresolvedInputs(tickets)).toEqual([]);
  });

  it("orders tickets by number", () => {
    const tickets = [
      row(5, { consumes: [consume("b", null)], unproduced: [stored("b", null, "no-source")] }),
      row(2, { consumes: [consume("a", null)], unproduced: [stored("a", null, "no-source")] }),
    ];

    expect(unresolvedInputs(tickets)).toEqual([
      gap(2, "a", null, "no-source"),
      gap(5, "b", null, "no-source"),
    ]);
  });

  it("leaves out a gate's gaps", () => {
    const tickets = [
      row(1, {
        kind: "gate",
        consumes: [],
        unproduced: [stored("x", null, "no-source")],
      }),
    ];

    expect(unresolvedInputs(tickets)).toEqual([]);
  });

  it("reads a null unproduced with a non-null consumes as no stored gaps", () => {
    expect(unresolvedInputs([row(1), row(2, { unproduced: null }), row(3)])).toEqual([]);
  });

  it("puts a stored gap that matches no entry after the matched ones", () => {
    const tickets = [
      row(3, {
        consumes: [consume("a", null)],
        unproduced: [stored("zz", null, "no-source"), stored("a", null, "no-source")],
      }),
    ];

    expect(unresolvedInputs(tickets)).toEqual([
      gap(3, "a", null, "no-source"),
      gap(3, "zz", null, "no-source"),
    ]);
  });

  it("does not de-duplicate identical entries", () => {
    const tickets = [
      row(3, {
        consumes: [consume("x", null), consume("x", null)],
        unproduced: [stored("x", null, "no-source"), stored("x", null, "no-source")],
      }),
    ];

    expect(unresolvedInputs(tickets)).toEqual([
      gap(3, "x", null, "no-source"),
      gap(3, "x", null, "no-source"),
    ]);
  });

  it("keeps stored order for gaps at one index", () => {
    const tickets = [
      row(3, {
        consumes: [consume("x", null)],
        unproduced: [stored("x", null, "not-tracked"), stored("x", null, "no-source")],
      }),
    ];

    expect(unresolvedInputs(tickets)).toEqual([
      gap(3, "x", null, "not-tracked"),
      gap(3, "x", null, "no-source"),
    ]);
  });

  it("returns nothing for duplicate ticket numbers, whichever kind of gap", () => {
    const tickets = [
      row(3, { unproduced: [stored("a", null, "no-source")], consumes: [consume("a", null)] }),
      row(3, { blockedBy: [1], consumes: [consume("gr_spans table", 4)] }),
      row(4, { produces: ["gr_spans table"] }),
    ];

    expect(unresolvedInputs(tickets)).toEqual([]);
  });
});
