import { describe, expect, it } from "vitest";

import { blockersThroughGates, type TicketForGates } from "./ticket-gates.js";

const build = (number: number, blockedBy: number[] = []): TicketForGates => ({
  number,
  kind: "build",
  blockedBy,
});
const gate = (number: number, blockedBy: number[] = []): TicketForGates => ({
  number,
  kind: "gate",
  blockedBy,
});

describe("blockersThroughGates", () => {
  it.each<[string, TicketForGates[], [number, number[]][]]>([
    ["1 build; 2 gate; 3 build ←[1, 2]", [build(1), gate(2), build(3, [1, 2])], [[1, []], [3, [1]]]],
    ["1 build; 2 gate ←[1]; 3 build ←[2]", [build(1), gate(2, [1]), build(3, [2])], [[1, []], [3, [1]]]],
    [
      "1 build; 2 gate ←[1]; 3 gate ←[2]; 4 build ←[3, 1]",
      [build(1), gate(2, [1]), gate(3, [2]), build(4, [3, 1])],
      [[1, []], [4, [1]]],
    ],
    [
      "1 build; 2 build ←[1]; 3 gate ←[2]; 4 build ←[3]",
      [build(1), build(2, [1]), gate(3, [2]), build(4, [3])],
      [[1, []], [2, [1]], [4, [2]]],
    ],
    [
      "no gates: each build ticket's own blockedBy, sorted",
      [build(1), build(2), build(3, [2, 1]), { number: 4, blockedBy: [3] }],
      [[1, []], [2, []], [3, [1, 2]], [4, [3]]],
    ],
    ["a blocker outside the set is dropped", [build(1), build(2, [1, 9])], [[1, []], [2, [1]]]],
    [
      "a cycle through gates stops at a gate already visited",
      [build(1), gate(2, [3, 1]), gate(3, [2]), build(4, [2])],
      [[1, []], [4, [1]]],
    ],
  ])("%s", (_, tickets, expected) => {
    expect([...blockersThroughGates(tickets)]).toEqual(expected);
  });
});
