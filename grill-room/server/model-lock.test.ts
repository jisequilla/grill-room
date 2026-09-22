/**
 * Unit tests for the lock rule itself, isolated from the action and the
 * payload builder that both depend on it. See `model-lock.ts` for the rule.
 */
import { describe, expect, it } from "vitest";

import { isModelLocked } from "./model-lock.js";

describe("isModelLocked", () => {
  it("is unlocked for a fresh session (no conversation id, idle)", () => {
    expect(
      isModelLocked({ conversationId: null, turnStatus: "idle" }),
    ).toBe(false);
  });

  it("is unlocked after a turn failed without ever setting a conversation id", () => {
    expect(
      isModelLocked({ conversationId: null, turnStatus: "failed" }),
    ).toBe(false);
  });

  it.each(["idle", "working", "failed"] as const)(
    "is locked once a conversation id exists, regardless of turn status (%s)",
    (turnStatus) => {
      expect(isModelLocked({ conversationId: "conv-1", turnStatus })).toBe(
        true,
      );
    },
  );

  it("is locked while a turn is working, even with no conversation id yet", () => {
    expect(
      isModelLocked({ conversationId: null, turnStatus: "working" }),
    ).toBe(true);
  });
});
