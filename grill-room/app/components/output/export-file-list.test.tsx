import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  ExportFileList,
  type PlannedFile,
} from "@/components/output/export-file-list";

/*
 * These render with no i18n catalog wired up (the same bare
 * `renderToStaticMarkup` pattern `readiness-panel.test.tsx` uses), so `useT()`
 * falls back to a humanized version of the key rather than this app's actual
 * `en-US.ts` copy. Assertions therefore read structure, test ids, and the
 * component's own data attributes, never the rendered label text.
 */

function files(
  specs: { relativePath: string; edited?: boolean }[],
): PlannedFile[] {
  return specs.map(({ relativePath, edited = false }) => ({
    path: `/repo/.scratch/feature/${relativePath}`,
    relativePath,
    edited,
  }));
}

/**
 * The markup from a `<li>` opening tag carrying `data-testid="<testId>-item"`
 * up to its matching close, isolated by the file's path text.
 */
function item(html: string, path: string): string {
  const at = html.indexOf(path);
  expect(at, `${path} is rendered`).toBeGreaterThan(-1);
  const start = html.lastIndexOf("<li", at);
  const end = html.indexOf("</li>", at) + "</li>".length;
  return html.slice(start, end);
}

function render(
  planned: readonly PlannedFile[],
  overridePaths: ReadonlySet<string> = new Set(),
) {
  return renderToStaticMarkup(
    <ExportFileList
      files={planned}
      overridePaths={overridePaths}
      onToggleOverride={() => {}}
      overrideLabelKey="output.exportOverwriteAnyway"
      testId="export-preview-files"
    />,
  );
}

describe("ExportFileList", () => {
  it("lists every planned file with no checkbox when nothing is edited", () => {
    const html = render(
      files([{ relativePath: "spec.md" }, { relativePath: "decisions.md" }]),
    );

    expect(html).toContain("spec.md");
    expect(html).toContain("decisions.md");
    expect(html).not.toContain('data-testid="export-preview-files-override"');
  });

  it("marks an edited file with an unticked override checkbox", () => {
    const html = render(files([{ relativePath: "spec.md", edited: true }]));
    const row = item(html, "spec.md");

    expect(row).toContain('data-edited="true"');
    expect(row).toContain('data-testid="export-preview-files-override"');
    expect(row).not.toContain('data-state="checked"');
  });

  it("ticks the checkbox for a path already in the override set", () => {
    const html = render(
      files([{ relativePath: "spec.md", edited: true }]),
      new Set(["spec.md"]),
    );
    const row = item(html, "spec.md");

    expect(row).toContain('data-state="checked"');
  });

  it("leaves an unedited file's checkbox off the override set unticked", () => {
    const html = render(files([{ relativePath: "spec.md", edited: false }]));

    expect(html).not.toContain('data-testid="export-preview-files-override"');
  });
});
