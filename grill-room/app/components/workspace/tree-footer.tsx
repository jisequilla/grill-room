import { useT } from "@agent-native/core/client/i18n";

import { cn } from "@/lib/utils";

/**
 * How far the session has come, pinned to the bottom of the tree panel: the
 * two numbers that answer "how far am I" without opening the sheet, and the
 * job that keeps a full-height panel from being a stretched empty box.
 *
 * `looseEnds` is the count from `list-loose-ends`, so this row and the loose
 * ends list can never disagree about what is still open.
 */
export function TreeFooter({
  settled,
  total,
  looseEnds,
}: {
  settled: number;
  total: number;
  looseEnds: number;
}) {
  const t = useT();

  return (
    <div
      className="flex items-center justify-between gap-3 border-t px-3 py-2.5 text-xs tabular-nums"
      data-testid="tree-footer"
    >
      <span className="text-muted-foreground">
        {t("workspace.treeSettled", { settled, total })}
      </span>
      <span
        className={cn(
          looseEnds > 0
            ? "font-medium text-orange-700 dark:text-orange-300"
            : "text-muted-foreground",
        )}
      >
        {looseEnds > 0
          ? t("workspace.treeLooseEnds", { count: looseEnds })
          : t("workspace.treeNoLooseEnds")}
      </span>
    </div>
  );
}
