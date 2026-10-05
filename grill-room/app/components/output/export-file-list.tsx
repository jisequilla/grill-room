import { useT } from "@agent-native/core/client/i18n";

import { Checkbox } from "@/components/ui/checkbox";

export interface PlannedFile {
  path: string;
  /** `durable` (spec, intent, decisions) or `working` (handoff, issues, briefs), plus each root's manifest. */
  root: "durable" | "working";
  /** Relative to its root's bundle folder. */
  relativePath: string;
  /** Relative to the project root: what export-session's `overridePaths` takes. */
  rootRelativePath: string;
  edited: boolean;
}

/** The bundle folder holding `file`, relative to the project root. */
function bundleFolderOf(file: PlannedFile): string {
  return file.rootRelativePath.slice(
    0,
    file.rootRelativePath.length - file.relativePath.length - 1,
  );
}

/**
 * A planned write or removal, one per line, each with its root's bundle
 * folder. An edited file — on disk but no longer matching what Grill Room
 * last wrote, or never written by Grill Room at all — carries an
 * "overwrite/remove anyway" checkbox, unticked by default; its
 * project-root-relative path is what export-session's `overridePaths` takes.
 */
export function ExportFileList({
  files,
  overridePaths,
  onToggleOverride,
  overrideLabelKey,
  testId,
}: {
  files: readonly PlannedFile[];
  overridePaths: ReadonlySet<string>;
  onToggleOverride: (rootRelativePath: string, override: boolean) => void;
  overrideLabelKey: string;
  testId: string;
}) {
  const t = useT();

  return (
    <ul className="space-y-1" data-testid={testId}>
      {files.map((file) => (
        <li
          key={file.path}
          className="flex flex-wrap items-center gap-x-2 gap-y-1"
          data-testid={`${testId}-item`}
          data-edited={file.edited}
          data-root={file.root}
        >
          <span
            className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs text-muted-foreground"
            data-testid={`${testId}-folder`}
          >
            {bundleFolderOf(file)}
          </span>
          <span className="font-mono text-xs break-all text-muted-foreground">
            {file.path}
          </span>
          {file.edited ? (
            <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Checkbox
                checked={overridePaths.has(file.rootRelativePath)}
                onCheckedChange={(checked) =>
                  onToggleOverride(file.rootRelativePath, checked === true)
                }
                data-testid={`${testId}-override`}
              />
              {t(overrideLabelKey)}
            </label>
          ) : null}
        </li>
      ))}
    </ul>
  );
}
