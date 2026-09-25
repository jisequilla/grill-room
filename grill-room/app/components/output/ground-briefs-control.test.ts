import { describe, expect, it } from "vitest";

import {
  groundBriefsDisabledCode,
  groundingBadgeState,
  shortSha,
} from "@/components/output/ground-briefs-control";

/**
 * These test the pure, data-only pieces of `GroundBriefsControl` directly —
 * no rendering, no query mocking — the same way `turn-attempt-log.test.tsx`'s
 * doc comment explains the render tests avoid asserting translated copy:
 * here there is no rendering at all, so nothing to avoid.
 */

describe("shortSha", () => {
  it("takes a commit's first 7 characters", () => {
    expect(shortSha("728db97f8b5b91b757f8f7fc5d1575b8c800a2b")).toBe("728db97");
  });

  it("is null for a repository with no commits yet", () => {
    expect(shortSha(null)).toBeNull();
  });
});

describe("groundingBadgeState", () => {
  it("is absent when the session has no grounding", () => {
    expect(groundingBadgeState(null)).toBe("absent");
  });

  it("is current when the grounding is current", () => {
    expect(groundingBadgeState({ current: true })).toBe("current");
  });

  it("is stale when the grounding is not current", () => {
    expect(groundingBadgeState({ current: false })).toBe("stale");
  });
});

describe("groundBriefsDisabledCode", () => {
  /** Every input satisfied — nothing disables the button. */
  const ok = {
    working: false,
    hasProject: true,
    hasHandoff: true,
    handoffStale: false,
    tooManyTickets: false,
    tooManyBlockers: false,
  };

  it("is null when nothing refuses", () => {
    expect(groundBriefsDisabledCode(ok)).toBeNull();
  });

  it("reads turn-working first, ahead of every other refusal", () => {
    expect(
      groundBriefsDisabledCode({
        ...ok,
        working: true,
        hasProject: false,
        hasHandoff: false,
        handoffStale: true,
        tooManyTickets: true,
        tooManyBlockers: true,
      }),
    ).toBe("turn-working");
  });

  it("reads no-project ahead of no-handoff, handoff-stale and the two caps", () => {
    expect(
      groundBriefsDisabledCode({
        ...ok,
        hasProject: false,
        hasHandoff: false,
        handoffStale: true,
        tooManyTickets: true,
        tooManyBlockers: true,
      }),
    ).toBe("no-project");
  });

  it("reads no-handoff ahead of handoff-stale and the two caps", () => {
    expect(
      groundBriefsDisabledCode({
        ...ok,
        hasHandoff: false,
        handoffStale: true,
        tooManyTickets: true,
        tooManyBlockers: true,
      }),
    ).toBe("no-handoff");
  });

  it("reads handoff-stale ahead of the two caps", () => {
    expect(
      groundBriefsDisabledCode({
        ...ok,
        handoffStale: true,
        tooManyTickets: true,
        tooManyBlockers: true,
      }),
    ).toBe("handoff-stale");
  });

  it("reads too-many-tickets ahead of too-many-blockers", () => {
    expect(
      groundBriefsDisabledCode({
        ...ok,
        tooManyTickets: true,
        tooManyBlockers: true,
      }),
    ).toBe("too-many-tickets");
  });

  it("reads too-many-blockers once every earlier refusal is clear", () => {
    expect(groundBriefsDisabledCode({ ...ok, tooManyBlockers: true })).toBe(
      "too-many-blockers",
    );
  });
});
