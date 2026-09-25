import { describe, expect, it } from "vitest";

import { visibleUngroundedBriefs } from "@/components/output/export-section";

describe("visibleUngroundedBriefs", () => {
  const briefs = [
    { ticket: 1, reason: "no-grounding" as const },
    { ticket: 2, reason: "no-grounding" as const },
  ];

  it("collapses to nothing when the grounding is absent", () => {
    // Every entry's reason is `no-grounding` when the state is `absent` — the
    // grounding line above already says so once, so listing it again per
    // ticket is pure repetition.
    expect(visibleUngroundedBriefs("absent", briefs)).toEqual([]);
  });

  it("keeps every entry when the grounding is current", () => {
    const mixed = [
      { ticket: 3, reason: "edited" as const },
      { ticket: 4, reason: "not-covered" as const },
      { ticket: 5, reason: "kept" as const },
    ];
    expect(visibleUngroundedBriefs("current", mixed)).toEqual(mixed);
  });

  it("keeps every entry when the grounding is stale", () => {
    const mixed = [{ ticket: 6, reason: "not-covered" as const }];
    expect(visibleUngroundedBriefs("stale", mixed)).toEqual(mixed);
  });

  it("is empty when there is nothing to list, regardless of state", () => {
    expect(visibleUngroundedBriefs("current", [])).toEqual([]);
  });
});
