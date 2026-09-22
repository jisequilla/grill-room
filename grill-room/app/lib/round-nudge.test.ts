import { describe, expect, it } from "vitest";

import { shouldShowRoundNudge } from "@/lib/round-nudge";

function rounds(cardCounts: readonly number[]) {
  return cardCounts.map((cardCount) => ({ cardCount }));
}

describe("shouldShowRoundNudge", () => {
  it("stays silent in whole-round mode, no matter the round history", () => {
    expect(
      shouldShowRoundNudge({
        answeringMode: "whole-round",
        submittedRounds: rounds(Array(10).fill(1)),
        dismissedAtRoundCount: null,
      }),
    ).toBe(false);
  });

  it("stays silent before 10 rounds have been submitted", () => {
    expect(
      shouldShowRoundNudge({
        answeringMode: "one-at-a-time",
        submittedRounds: rounds(Array(9).fill(1)),
        dismissedAtRoundCount: null,
      }),
    ).toBe(false);
  });

  it("shows once the last 10 submitted rounds each carried exactly one card", () => {
    expect(
      shouldShowRoundNudge({
        answeringMode: "one-at-a-time",
        submittedRounds: rounds(Array(10).fill(1)),
        dismissedAtRoundCount: null,
      }),
    ).toBe(true);
  });

  it("shows once past 10 rounds too, judging only the trailing 10", () => {
    expect(
      shouldShowRoundNudge({
        answeringMode: "one-at-a-time",
        submittedRounds: rounds([3, 2, ...Array(10).fill(1)]),
        dismissedAtRoundCount: null,
      }),
    ).toBe(true);
  });

  it("stays silent when any of the last 10 rounds carried more than one card", () => {
    expect(
      shouldShowRoundNudge({
        answeringMode: "one-at-a-time",
        submittedRounds: rounds([...Array(9).fill(1), 2]),
        dismissedAtRoundCount: null,
      }),
    ).toBe(false);
  });

  it("stays silent right after a dismissal, even if the streak is still unbroken", () => {
    expect(
      shouldShowRoundNudge({
        answeringMode: "one-at-a-time",
        submittedRounds: rounds(Array(12).fill(1)),
        dismissedAtRoundCount: 10,
      }),
    ).toBe(false);
  });

  it("shows again once 10 more rounds have been submitted since the dismissal", () => {
    expect(
      shouldShowRoundNudge({
        answeringMode: "one-at-a-time",
        submittedRounds: rounds(Array(20).fill(1)),
        dismissedAtRoundCount: 10,
      }),
    ).toBe(true);
  });

  it("stays silent one round short of the snooze, even with an unbroken streak", () => {
    expect(
      shouldShowRoundNudge({
        answeringMode: "one-at-a-time",
        submittedRounds: rounds(Array(19).fill(1)),
        dismissedAtRoundCount: 10,
      }),
    ).toBe(false);
  });

  it("requires a fresh trailing streak after the snooze window opens, a mixed round in between still counts against it", () => {
    expect(
      shouldShowRoundNudge({
        answeringMode: "one-at-a-time",
        submittedRounds: rounds([...Array(10).fill(1), 2, ...Array(9).fill(1)]),
        dismissedAtRoundCount: 10,
      }),
    ).toBe(false);
  });
});
