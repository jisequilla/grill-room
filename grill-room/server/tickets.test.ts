import { describe, expect, it } from "vitest";

import { collisionKey } from "./brief-grounding.js";
import {
  computeWaves,
  separateOverlaps,
  type ImplicitEdge,
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
