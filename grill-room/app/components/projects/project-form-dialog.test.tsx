import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { FolderVisibilityLine } from "@/components/projects/project-form-dialog";

/*
 * Rendered with no i18n catalog, so assertions read test ids, never text.
 */

const DURABLE = "project-durable-ignored-warning";
const WORKING = "project-working-ignored-note";

function render(props: Parameters<typeof FolderVisibilityLine>[0]) {
  return renderToStaticMarkup(<FolderVisibilityLine {...props} />);
}

describe("folder visibility lines", () => {
  it("durable, ignored, field equals the saved folder: renders the warning", () => {
    const html = render({ kind: "durable", measured: "ignored", savedFolder: "docs/specs", field: "docs/specs" });
    expect(html).toContain(DURABLE);
    expect(html).toContain("text-owed");
    expect(html).not.toContain(WORKING);
  });

  it("working, ignored, field equals the saved folder: renders the note", () => {
    const html = render({ kind: "working", measured: "ignored", savedFolder: ".scratch", field: ".scratch" });
    expect(html).toContain(WORKING);
    expect(html).not.toContain(DURABLE);
  });

  it("compares the field trimmed, as the save trims it", () => {
    expect(
      render({ kind: "durable", measured: "ignored", savedFolder: "docs/specs", field: "  docs/specs " }),
    ).toContain(DURABLE);
  });

  it.each(["durable", "working"] as const)("%s, tracked or null: renders nothing", (kind) => {
    expect(render({ kind, measured: "tracked", savedFolder: "x", field: "x" })).toBe("");
    expect(render({ kind, measured: null, savedFolder: "x", field: "x" })).toBe("");
  });

  it.each(["durable", "working"] as const)("%s, ignored but the field was edited: renders nothing", (kind) => {
    expect(render({ kind, measured: "ignored", savedFolder: "docs/specs", field: "docs/other" })).toBe("");
  });

  it.each(["durable", "working"] as const)("%s, registering (no query data): renders nothing", (kind) => {
    expect(render({ kind, measured: undefined, savedFolder: undefined, field: "docs/specs" })).toBe("");
  });

  it("durable, the query still holds the previous folder after saving a new one: renders nothing", () => {
    expect(
      render({ kind: "durable", measured: "ignored", savedFolder: "docs/old", field: "docs/new" }),
    ).toBe("");
  });
});
