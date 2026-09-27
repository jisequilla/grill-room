import { describe, expect, it } from "vitest";

import { collisionKey } from "./brief-grounding.js";
import {
  chainLimit,
  chainReason,
  computeWaves,
  longestChain,
  numberRanges,
  parseImplements,
  separateOverlaps,
  userStories,
  type ImplicitEdge,
  type ProposedTicket,
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
