import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { SessionIdea } from "@/components/workspace/session-idea";

const save = async () => {};

describe("SessionIdea", () => {
  it("offers an edit control while the idea can still change", () => {
    const html = renderToStaticMarkup(
      <SessionIdea idea="A PWA for marathon training" canEdit onSave={save} />,
    );

    expect(html).toContain("A PWA for marathon training");
    expect(html).toContain('data-testid="idea-edit"');
    expect(html).not.toContain('data-testid="idea-textarea"');
  });

  it("is read-only once the idea is locked", () => {
    const html = renderToStaticMarkup(
      <SessionIdea
        idea="A PWA for marathon training"
        canEdit={false}
        onSave={save}
      />,
    );

    expect(html).toContain("A PWA for marathon training");
    expect(html).not.toContain('data-testid="idea-edit"');
  });
});
