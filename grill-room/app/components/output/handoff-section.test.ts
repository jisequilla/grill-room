import { describe, expect, it } from "vitest";

import { viewedDocumentText } from "@/components/output/handoff-section";

describe("viewedDocumentText", () => {
  it("fills every bundle token, and leaves the text alone without a path", () => {
    expect(
      viewedDocumentText("A `{{BUNDLE}}/spec.md` and `{{BUNDLE}}/issues/`", ".scratch/01-x"),
    ).toBe("A `.scratch/01-x/spec.md` and `.scratch/01-x/issues/`");

    expect(viewedDocumentText("A `{{BUNDLE}}/spec.md`", null)).toBe("A `{{BUNDLE}}/spec.md`");

    expect(viewedDocumentText("no token", "/abs/b")).toBe("no token");
  });
});
