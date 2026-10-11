import { describe, expect, it } from "vitest";

import { inputGapPhrase, ticketGapLines, type InputGapLike } from "./input-gaps.js";

const padded = (n: number) => String(n).padStart(2, "0");
const hashed = (n: number) => `#${n}`;

describe("inputGapPhrase", () => {
  it.each<[string, Parameters<typeof inputGapPhrase>[0], string, string]>([
    [
      "no source",
      { ticket: 2, from: null, reason: "no-source" },
      "no ticket or repository file provides it.",
      "no ticket or repository file provides it.",
    ],
    [
      "not produced",
      { ticket: 3, from: 1, reason: "not-produced" },
      "ticket 01 does not list it in what it produces.",
      "ticket #1 does not list it in what it produces.",
    ],
    [
      "unknown ticket",
      { ticket: 3, from: 9, reason: "unknown-ticket" },
      "it names ticket 09, which does not exist.",
      "it names ticket #9, which does not exist.",
    ],
    [
      "itself",
      { ticket: 3, from: 3, reason: "unknown-ticket" },
      "it names itself as its source.",
      "it names itself as its source.",
    ],
    [
      "not upstream",
      { ticket: 3, from: 4, reason: "not-upstream" },
      "ticket 04 produces it but is not upstream through Blocked by.",
      "ticket #4 produces it but is not upstream through Blocked by.",
    ],
    [
      "not tracked",
      { ticket: 5, from: "repo", reason: "not-tracked" },
      "the repository tracks no file at that path.",
      "the repository tracks no file at that path.",
    ],
    [
      "not-produced with a repo source",
      { ticket: 3, from: "repo", reason: "not-produced" },
      "no ticket or repository file provides it.",
      "no ticket or repository file provides it.",
    ],
    [
      "unknown-ticket with a null source",
      { ticket: 3, from: null, reason: "unknown-ticket" },
      "no ticket or repository file provides it.",
      "no ticket or repository file provides it.",
    ],
    [
      "not-upstream with a repo source",
      { ticket: 3, from: "repo", reason: "not-upstream" },
      "no ticket or repository file provides it.",
      "no ticket or repository file provides it.",
    ],
  ])("%s", (_name, gap, withPadding, withHash) => {
    expect(inputGapPhrase(gap, padded)).toBe(withPadding);
    expect(inputGapPhrase(gap, hashed)).toBe(withHash);
  });
});

describe("ticketGapLines", () => {
  const gaps: InputGapLike[] = [
    { ticket: 2, item: "zeta", from: 4, reason: "not-upstream" },
    { ticket: 3, item: "q", from: "repo", reason: "not-tracked" },
    { ticket: 2, item: "alpha", from: null, reason: "no-source" },
  ];

  it("lists one ticket's gaps in the order given", () => {
    expect(ticketGapLines(gaps, 2, hashed)).toEqual([
      '"zeta" — ticket #4 produces it but is not upstream through Blocked by.',
      '"alpha" — no ticket or repository file provides it.',
    ]);
  });

  it("is empty for a ticket with no gaps", () => {
    expect(ticketGapLines(gaps, 1, hashed)).toEqual([]);
  });

  it("writes the item with JSON.stringify", () => {
    expect(
      ticketGapLines([{ ticket: 2, item: 'say "hi"', from: null, reason: "no-source" }], 2, hashed),
    ).toEqual([`${JSON.stringify('say "hi"')} — no ticket or repository file provides it.`]);
  });
});
