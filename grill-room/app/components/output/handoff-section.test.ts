import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { HandoffRecipeWarning, viewedDocumentText } from "@/components/output/handoff-section";

describe("viewedDocumentText", () => {
  it("fills every bundle token, and leaves the text alone without a path", () => {
    expect(
      viewedDocumentText("A `{{BUNDLE}}/spec.md` and `{{BUNDLE}}/issues/`", ".scratch/01-x"),
    ).toBe("A `.scratch/01-x/spec.md` and `.scratch/01-x/issues/`");

    expect(viewedDocumentText("A `{{BUNDLE}}/spec.md`", null)).toBe("A `{{BUNDLE}}/spec.md`");

    expect(viewedDocumentText("no token", "/abs/b")).toBe("no token");
  });
});

describe("HandoffRecipeWarning", () => {
  const t = (key: string) => key;

  it("shows the warning, and nothing for null", () => {
    expect(
      renderToStaticMarkup(
        createElement(HandoffRecipeWarning, { warning: "pull-request-without-remote", t }),
      ),
    ).toContain('data-testid="handoff-recipe-warning"');
    expect(renderToStaticMarkup(createElement(HandoffRecipeWarning, { warning: null, t }))).toBe("");
  });
});
