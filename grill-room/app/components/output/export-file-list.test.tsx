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
  return specs.map(({ relativePath, edited = false }) => {
    const root = DURABLE.has(relativePath) ? "durable" : "working";
    const folder = root === "durable" ? "docs/specs/feature" : ".scratch/feature";
    return {
      path: `/repo/${folder}/${relativePath}`,
      root,
      relativePath,
      rootRelativePath: `${folder}/${relativePath}`,
      edited,
    };
  });
}

const DURABLE = new Set(["spec.md", "intent.md", "decisions.md"]);

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
      new Set(["docs/specs/feature/spec.md"]),
    );
    const row = item(html, "spec.md");

    expect(row).toContain('data-state="checked"');
  });

  it("marks each item with its root and shows its root's bundle folder", () => {
    const html = render(
      files([{ relativePath: "spec.md" }, { relativePath: "HANDOFF.md" }]),
    );

    const durableRow = item(html, "/repo/docs/specs/feature/spec.md");
    expect(durableRow).toContain('data-root="durable"');
    expect(durableRow).toMatch(
      /data-testid="export-preview-files-folder"[^>]*>docs\/specs\/feature</,
    );
    const workingRow = item(html, "/repo/.scratch/feature/HANDOFF.md");
    expect(workingRow).toContain('data-root="working"');
    expect(workingRow).toMatch(
      /data-testid="export-preview-files-folder"[^>]*>\.scratch\/feature</,
    );
  });

  it("toggles an override by the project-root-relative path, not the bundle-relative one", () => {
    const planned = files([
      { relativePath: "spec.md", edited: true },
      { relativePath: "HANDOFF.md", edited: true },
    ]);

    const byBundlePath = render(planned, new Set(["spec.md", "HANDOFF.md"]));
    expect(item(byBundlePath, "/repo/docs/specs/feature/spec.md")).not.toContain(
      'data-state="checked"',
    );
    expect(item(byBundlePath, "/repo/.scratch/feature/HANDOFF.md")).not.toContain(
      'data-state="checked"',
    );

    const byRootPath = render(planned, new Set([".scratch/feature/HANDOFF.md"]));
    expect(item(byRootPath, "/repo/docs/specs/feature/spec.md")).not.toContain(
      'data-state="checked"',
    );
    expect(item(byRootPath, "/repo/.scratch/feature/HANDOFF.md")).toContain(
      'data-state="checked"',
    );
  });

  it("leaves an unedited file's checkbox off the override set unticked", () => {
    const html = render(files([{ relativePath: "spec.md", edited: false }]));

    expect(html).not.toContain('data-testid="export-preview-files-override"');
  });
});
