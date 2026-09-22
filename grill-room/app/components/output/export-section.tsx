import {
  actionErrorMessage,
  useActionMutation,
} from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import { IconFolderOpen } from "@tabler/icons-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { actionErrorCode, actionErrorDetails } from "@/lib/decisions";

/** Every code `export-session` throws that is not `files-exist` (handled with its own confirm dialog). */
const EXPORT_ERROR_KEY: Record<string, string> = {
  "no-export-target": "output.exportNoTarget",
  "spec-missing": "output.exportSpecMissing",
  "spec-not-current": "output.exportSpecNotCurrent",
  "target-not-found": "output.exportTargetNotFound",
  "target-not-directory": "output.exportTargetNotDirectory",
  "target-not-writable": "output.exportTargetNotWritable",
};

type ExportResult = AgentNativeActionRegistry["export-session"]["result"];

export function ExportSection({
  sessionId,
  exportTargetFolder,
}: {
  sessionId: string;
  exportTargetFolder: string | null;
}) {
  const t = useT();
  const [folder, setFolder] = useState(exportTargetFolder ?? "");
  const [folderError, setFolderError] = useState<string | null>(null);
  const [existingFiles, setExistingFiles] = useState<string[] | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<ExportResult | null>(null);

  // The saved target can change from another tab or from the command line;
  // only overwrite the field while the user has not started editing it.
  useEffect(() => {
    setFolder((current) =>
      current === "" || current === exportTargetFolder
        ? (exportTargetFolder ?? "")
        : current,
    );
  }, [exportTargetFolder]);

  const setTarget = useActionMutation("set-export-target", {
    onSuccess: () => setFolderError(null),
    onError: (error: unknown) => {
      const code = actionErrorCode(error);
      if (code === "folder-not-absolute") {
        setFolderError(t("output.exportFolderNotAbsolute"));
        return;
      }
      toast.error(actionErrorMessage(error) ?? t("output.exportFolderSaveFailed"));
    },
  });

  const exportSession = useActionMutation("export-session", {
    onSuccess: (result: ExportResult) => {
      setLastResult(result);
      setExportError(null);
      setExistingFiles(null);
    },
    onError: (error: unknown) => {
      const code = actionErrorCode(error);
      if (code === "files-exist") {
        const details = actionErrorDetails(error);
        const existing = details?.existing;
        setExistingFiles(Array.isArray(existing) ? (existing as string[]) : []);
        return;
      }
      setLastResult(null);
      const key = EXPORT_ERROR_KEY[code ?? ""];
      setExportError(key ? t(key) : actionErrorMessage(error) ?? t("output.exportFailed"));
    },
  });

  const folderDirty = folder.trim() !== (exportTargetFolder ?? "");

  function saveFolder() {
    if (folder.trim().length === 0 || setTarget.isPending) return;
    setTarget.mutate({ sessionId, folder: folder.trim() });
  }

  function runExport(overwrite: boolean) {
    if (exportSession.isPending) return;
    setExportError(null);
    exportSession.mutate({ sessionId, overwrite });
  }

  return (
    <section className="space-y-3" data-testid="output-export-section">
      <h2 className="text-sm font-medium">{t("output.exportHeading")}</h2>

      <div className="space-y-3 rounded-xl border bg-card px-5 py-4">
        <div className="flex items-end gap-2">
          <div className="flex-1 space-y-2">
            <Label htmlFor="export-folder">{t("output.exportFolderLabel")}</Label>
            <Input
              id="export-folder"
              value={folder}
              onChange={(event) => {
                setFolder(event.target.value);
                setFolderError(null);
              }}
              placeholder={t("output.exportFolderPlaceholder")}
              aria-invalid={folderError !== null}
              data-testid="export-folder-input"
            />
            {folderError ? (
              <p className="text-xs text-destructive">{folderError}</p>
            ) : null}
          </div>
          <Button
            type="button"
            variant="outline"
            disabled={!folderDirty || folder.trim().length === 0 || setTarget.isPending}
            onClick={saveFolder}
            data-testid="export-folder-save"
          >
            {setTarget.isPending && <Spinner className="size-4" />}
            {t(setTarget.isPending ? "output.exportFolderSaving" : "output.exportFolderSave")}
          </Button>
        </div>

        <Button
          type="button"
          disabled={!exportTargetFolder || folderDirty || exportSession.isPending}
          onClick={() => runExport(false)}
          data-testid="export-action"
        >
          {exportSession.isPending ? (
            <Spinner className="size-4" />
          ) : (
            <IconFolderOpen className="size-4" />
          )}
          {t(exportSession.isPending ? "output.exporting" : "output.exportAction")}
        </Button>

        {exportError ? (
          <Alert variant="destructive" data-testid="export-error">
            <AlertTitle>{exportError}</AlertTitle>
          </Alert>
        ) : null}

        {lastResult ? (
          <div className="space-y-1.5 rounded-lg border bg-muted/30 px-3.5 py-3">
            <p className="text-xs font-medium text-muted-foreground uppercase">
              {t("output.exportSuccessHeading")}
            </p>
            <p className="text-xs font-medium">{t("output.exportedFilesHeading")}</p>
            <ul className="space-y-0.5 font-mono text-xs text-muted-foreground">
              {lastResult.files.map((file) => (
                <li key={file}>{file}</li>
              ))}
            </ul>
            {lastResult.ticketsSkippedReason ? (
              <p className="text-xs text-amber-700 dark:text-amber-300">
                {t("output.exportTicketsSkipped")}: {lastResult.ticketsSkippedReason}
              </p>
            ) : null}
          </div>
        ) : null}
      </div>

      <AlertDialog
        open={existingFiles !== null}
        onOpenChange={(open) => {
          if (!open) setExistingFiles(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("output.exportOverwriteTitle")}</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2">
                <p>{t("output.exportOverwriteDescription")}</p>
                <ul className="max-h-40 space-y-0.5 overflow-y-auto rounded-md bg-muted/40 p-2 font-mono text-xs">
                  {(existingFiles ?? []).map((file) => (
                    <li key={file}>{file}</li>
                  ))}
                </ul>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("workspace.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              disabled={exportSession.isPending}
              onClick={() => {
                setExistingFiles(null);
                runExport(true);
              }}
            >
              {t("output.exportOverwriteConfirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
