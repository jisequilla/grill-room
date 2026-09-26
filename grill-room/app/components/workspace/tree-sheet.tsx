import { useT } from "@agent-native/core/client/i18n";
import { IconBinaryTree } from "@tabler/icons-react";
import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

/**
 * The header button that opens the ledger below `lg`, where the tree has no
 * column of its own. It carries the loose-end count, so "how much is owed"
 * stays one glance away without opening anything.
 */
export function TreeSheetTrigger({
  looseEnds,
  onOpen,
  className,
}: {
  looseEnds: number;
  onOpen: () => void;
  className?: string;
}) {
  const t = useT();

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className={cn("min-w-0 gap-1.5 px-2.5 text-xs tabular-nums", className)}
      onClick={onOpen}
      data-testid="tree-sheet-trigger"
    >
      <IconBinaryTree className="size-4 shrink-0" />
      <span className={cn("truncate", looseEnds > 0 && "text-owed")}>
        {looseEnds > 0
          ? t("workspace.treeSheetTrigger", { owed: looseEnds })
          : t("workspace.treeSheetTriggerClear")}
      </span>
    </Button>
  );
}

/**
 * The ledger as a sheet from the right, for widths where the tree column is
 * hidden. Its content is the column's own `DesignTree` and `TreeFooter`,
 * passed in unchanged.
 */
export function TreeSheet({
  open,
  onOpenChange,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: ReactNode;
}) {
  const t = useT();

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="flex w-full flex-col gap-3 sm:max-w-md"
        data-testid="tree-sheet"
      >
        <SheetHeader className="text-left">
          <SheetTitle className="text-base">
            {t("workspace.treeHeading")}
          </SheetTitle>
          <SheetDescription className="sr-only">
            {t("workspace.treeSheetDescription")}
          </SheetDescription>
        </SheetHeader>
        <div className="flex min-h-0 flex-1 flex-col rounded-xl border bg-card/50">
          {children}
        </div>
      </SheetContent>
    </Sheet>
  );
}
