import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { HandoffRecipeWarning, viewedDocumentText } from "@/components/output/handoff-section";

describe("viewedDocumentText", () => {
  it("fills every bundle token, and leaves the text alone without a path", () => {
    expect(
      viewedDocumentText("A `{{DOCS}}/spec.md` and `{{BUNDLE}}/issues/`", ".scratch/01-x", "docs/specs/01-x"),
    ).toBe("A `docs/specs/01-x/spec.md` and `.scratch/01-x/issues/`");

    expect(viewedDocumentText("no token", "/abs/b", "/abs/d")).toBe("no token");
  });

  it("moves an old {{BUNDLE}}/spec.md to the durable folder", () => {
    expect(
      viewedDocumentText("A `{{BUNDLE}}/spec.md` and `{{BUNDLE}}/briefs/`", ".scratch/01-x", "docs/specs/01-x"),
    ).toBe("A `docs/specs/01-x/spec.md` and `.scratch/01-x/briefs/`");
  });

  it("returns the text unchanged when either path is null", () => {
    const text = "A `{{DOCS}}/spec.md`, `{{BUNDLE}}/spec.md` and `{{BUNDLE}}/issues/`";
    expect(viewedDocumentText(text, null, null)).toBe(text);
    expect(viewedDocumentText(text, ".scratch/01-x", null)).toBe(text);
    expect(viewedDocumentText(text, null, "docs/specs/01-x")).toBe(text);
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
