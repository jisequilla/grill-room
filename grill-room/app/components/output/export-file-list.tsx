import { useT } from "@agent-native/core/client/i18n";

import { Checkbox } from "@/components/ui/checkbox";

export interface PlannedFile {
  path: string;
  relativePath: string;
  edited: boolean;
}

/**
 * A planned write or removal, one per line. An edited file — on disk but no
 * longer matching what Grill Room last wrote, or never written by Grill Room
 * at all — carries an "overwrite/remove anyway" checkbox, unticked by
 * default; its bundle-relative path is what export-session's `overridePaths`
 * takes.
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
  onToggleOverride: (relativePath: string, override: boolean) => void;
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
        >
          <span className="font-mono text-xs break-all text-muted-foreground">
            {file.path}
          </span>
          {file.edited ? (
            <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Checkbox
                checked={overridePaths.has(file.relativePath)}
                onCheckedChange={(checked) =>
                  onToggleOverride(file.relativePath, checked === true)
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
