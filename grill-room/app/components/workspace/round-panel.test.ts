import { describe, expect, it } from "vitest";

import { roundsExist, startPanelKind } from "@/components/workspace/round-panel";

describe("startPanelKind", () => {
  it("offers the next round only once a round exists, and nothing while unknown", () => {
    expect(startPanelKind(false)).toBe("start");
    expect(startPanelKind(true)).toBe("next");
    expect(startPanelKind(undefined)).toBe(null);
  });
});

describe("roundsExist", () => {
  it("knows whether a round exists only once the rounds load", () => {
    expect(roundsExist(undefined)).toBe(undefined);
    expect(roundsExist({ rounds: [] })).toBe(false);
    expect(roundsExist({ rounds: [{ id: "r1" }] })).toBe(true);
  });
});
