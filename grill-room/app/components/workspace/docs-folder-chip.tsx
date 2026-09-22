import {
  actionErrorMessage,
  useActionMutation,
} from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import { IconFolderCode } from "@tabler/icons-react";
import { useEffect, useState, type FormEvent } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { actionErrorCode } from "@/lib/decisions";
import { DOCS_FOLDER_ERROR_KEY } from "@/lib/docs-folder";

/**
 * The session's docs folder, beside the idea it qualifies. It is the one place
 * the app points the interviewer at the user's own files, so the header states
 * it rather than hiding it in a settings screen: a session reading a folder and
 * a session reading nothing are different interviews.
 */
export function DocsFolderChip({
  sessionId,
  docsFolder,
  onChanged,
}: {
  sessionId: string;
  docsFolder: string | null;
  onChanged: () => void;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [folder, setFolder] = useState(docsFolder ?? "");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setFolder(docsFolder ?? "");
    setError(null);
  }, [open, docsFolder]);

  const { mutate, isPending } = useActionMutation("set-docs-folder", {
    onSuccess: () => {
      setOpen(false);
      onChanged();
    },
    onError: (actionError: unknown) => {
      const key = DOCS_FOLDER_ERROR_KEY[actionErrorCode(actionError) ?? ""];
      if (key) {
        setError(t(key));
        return;
      }
      toast.error(
        actionErrorMessage(actionError) ?? t("workspace.docsFolderSaveFailed"),
      );
    },
  });

  function save(event: FormEvent) {
    event.preventDefault();
    if (isPending) return;
    setError(null);
    mutate({ sessionId, folder: folder.trim() });
  }

  function clear() {
    if (isPending) return;
    setError(null);
    mutate({ sessionId, folder: null });
  }

  return (
    <>
      <div className="flex items-center gap-1" data-testid="docs-folder-chip">
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="flex max-w-[22rem] items-center gap-1.5 text-sm text-muted-foreground">
              <IconFolderCode className="size-4 shrink-0" aria-hidden />
              <span className="truncate">
                {docsFolder
                  ? t("workspace.docsFolderSet", { folder: docsFolder })
                  : t("workspace.docsFolderNone")}
              </span>
            </span>
          </TooltipTrigger>
          <TooltipContent>{t("workspace.docsFolderTooltip")}</TooltipContent>
        </Tooltip>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="h-7 px-2 text-xs text-muted-foreground"
          onClick={() => setOpen(true)}
        >
          {t(docsFolder ? "workspace.docsFolderChange" : "workspace.docsFolderAdd")}
        </Button>
        {docsFolder ? (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-7 px-2 text-xs text-muted-foreground"
            disabled={isPending}
            onClick={clear}
          >
            {t("workspace.docsFolderClear")}
          </Button>
        ) : null}
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("workspace.docsFolderDialogTitle")}</DialogTitle>
            <DialogDescription>
              {t("workspace.docsFolderDialogDescription")}
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={save} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="docs-folder">
                {t("workspace.docsFolderLabel")}
              </Label>
              <Input
                id="docs-folder"
                value={folder}
                onChange={(event) => {
                  setFolder(event.target.value);
                  setError(null);
                }}
                placeholder={t("workspace.docsFolderPlaceholder")}
                aria-invalid={error !== null}
                spellCheck={false}
                autoFocus
              />
              {error ? (
                <p className="text-xs text-destructive">{error}</p>
              ) : null}
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="ghost"
                onClick={() => setOpen(false)}
              >
                {t("sessions.cancel")}
              </Button>
              <Button
                type="submit"
                disabled={folder.trim().length === 0 || isPending}
              >
                {isPending && <Spinner className="size-4" />}
                {t(
                  isPending
                    ? "workspace.docsFolderSaving"
                    : "workspace.docsFolderSave",
                )}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
