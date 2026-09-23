import { describe, expect, it } from "vitest";

import { computeWaves, type TicketForWaves } from "./tickets.js";

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
