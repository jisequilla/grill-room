import { useT } from "@agent-native/core/client/i18n";
import { IconDots, IconPlus, IconStack2 } from "@tabler/icons-react";
import { useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { AddDecisionDialog } from "@/components/workspace/add-decision-dialog";
import { useSetAnsweringMode } from "@/components/workspace/answering-mode-switch";
import { ApplyBatchDialog } from "@/components/workspace/batch/apply-batch-dialog";
import { ANSWERING_MODE_LABEL_KEY } from "@/lib/session-labels";

import {
  SESSION_ANSWERING_MODES,
  type SessionAnsweringMode,
} from "@shared/session-constants";

type MenuDialog = "batch" | "add";

/**
 * The session header's `…` button. At `lg` and wider it holds only "Apply a
 * batch of changes", the switch and "Add my own decision" being visible beside
 * it; below `lg` it holds every header action, so the title keeps the width.
 *
 * A dialog chosen here opens only once the menu has closed: the item records
 * which one, and the menu's close-focus event (fired after its focus return
 * and outside-pointer cleanup) opens it on the next tick. Opening a modal
 * dialog while the menu is still tearing down leaves `pointer-events: none`
 * on the body.
 */
export function HeaderOverflowMenu({
  sessionId,
  answeringMode,
}: {
  sessionId: string;
  answeringMode: SessionAnsweringMode;
}) {
  const t = useT();
  const setAnsweringMode = useSetAnsweringMode(sessionId, answeringMode);
  const pending = useRef<MenuDialog | null>(null);
  const [dialog, setDialog] = useState<MenuDialog | null>(null);

  function openPendingDialog() {
    const next = pending.current;
    if (next === null) return;
    pending.current = null;
    window.setTimeout(() => setDialog(next), 0);
  }

  function dialogProps(which: MenuDialog) {
    return {
      open: dialog === which,
      onOpenChange: (open: boolean) => setDialog(open ? which : null),
    };
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="w-9 shrink-0 px-0"
            aria-label={t("workspace.moreActions")}
            data-testid="header-overflow"
          >
            <IconDots className="size-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="end"
          className="w-60"
          onCloseAutoFocus={openPendingDialog}
        >
          <div className="lg:hidden">
            <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
              {t("workspace.answeringMode")}
            </DropdownMenuLabel>
            <DropdownMenuRadioGroup
              value={answeringMode}
              onValueChange={setAnsweringMode}
            >
              {SESSION_ANSWERING_MODES.map((value) => (
                <DropdownMenuRadioItem key={value} value={value}>
                  {t(ANSWERING_MODE_LABEL_KEY[value])}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
            <DropdownMenuSeparator />
          </div>
          <DropdownMenuItem
            onSelect={() => {
              pending.current = "batch";
            }}
          >
            <IconStack2 className="size-4" />
            {t("workspace.batchActionMenu")}
          </DropdownMenuItem>
          <DropdownMenuItem
            className="lg:hidden"
            onSelect={() => {
              pending.current = "add";
            }}
          >
            <IconPlus className="size-4" />
            {t("workspace.addDecisionMenu")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <ApplyBatchDialog sessionId={sessionId} {...dialogProps("batch")} />
      <AddDecisionDialog sessionId={sessionId} {...dialogProps("add")} />
    </>
  );
}
