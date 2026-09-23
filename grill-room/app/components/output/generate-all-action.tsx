import {
  actionErrorMessage,
  useActionMutation,
  useActionQuery,
} from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import { IconSparkles } from "@tabler/icons-react";
import { useState } from "react";
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
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { actionErrorCode } from "@/lib/decisions";

/** A turn takes a minute or more; the default 60 s client timeout cancels one about to succeed. */
const TURN_TIMEOUT_MS = 10 * 60 * 1000;

/** Failures the shared turn status banner above already reports; toasting them too would say it twice. */
const SILENT_ERROR_CODES = new Set([
  "turn-in-progress",
  "cli-missing",
  "not-logged-in",
  "rate-limited",
  "malformed-output",
  "invalid-tickets",
  "failed",
]);

function scrollToExportPreview() {
  document
    .getElementById("output-export-section")
    ?.scrollIntoView({ behavior: "smooth", block: "start" });
}

/**
 * The one-click shortcut from a written spec to an export-ready handoff:
 * breaks the spec into tickets when there are none or they are out of date,
 * generates the handoff, then scrolls to the export preview. Writes nothing
 * to disk itself — export stays its own explicit, confirmed step. The
 * individual actions (break into tickets, generate the handoff, export) stay
 * the primary controls in their own sections; this only chains them.
 *
 * When the stored handoff carries edits, generating over them needs the same
 * confirmation `HandoffSection`'s regenerate button asks for: this pauses
 * here rather than overwriting silently.
 */
export function GenerateAllAction({
  sessionId,
  working,
  onSettled,
}: {
  sessionId: string;
  /** Whether the session's stored turn is currently running, of any kind. */
  working: boolean;
  onSettled: () => void;
}) {
  const t = useT();
  const [running, setRunning] = useState(false);
  const [confirmOverwrite, setConfirmOverwrite] = useState(false);
  const [blockedMessage, setBlockedMessage] = useState<string | null>(null);

  const { data: specData } = useActionQuery("get-spec", { sessionId });
  const { data: ticketsData } = useActionQuery("list-tickets", { sessionId });

  const breakIntoTickets = useActionMutation("break-into-tickets", {
    timeoutMs: TURN_TIMEOUT_MS,
    onSettled,
  });
  const generateHandoff = useActionMutation("generate-handoff");

  const spec = specData?.spec ?? null;
  const tickets = ticketsData?.tickets ?? [];
  const ticketsCurrent = ticketsData?.ticketsCurrent ?? false;

  const busy =
    working || running || breakIntoTickets.isPending || generateHandoff.isPending;

  /** Generates the handoff; returns whether it landed (false pauses on the overwrite dialog). */
  async function generateHandoffStep(overwriteEdits: boolean): Promise<boolean> {
    try {
      await generateHandoff.mutateAsync({ sessionId, overwriteEdits });
      return true;
    } catch (error: unknown) {
      if (actionErrorCode(error) === "handoff-edited" && !overwriteEdits) {
        setConfirmOverwrite(true);
        return false;
      }
      throw error;
    }
  }

  function reportFailure(error: unknown, fallbackKey: string) {
    const code = actionErrorCode(error);
    if (code === "build-records-exist") {
      setBlockedMessage(t("output.generateAllBuildRecordsBlocked"));
      return;
    }
    if (SILENT_ERROR_CODES.has(code ?? "")) return;
    toast.error(actionErrorMessage(error) ?? t(fallbackKey));
  }

  async function run() {
    setBlockedMessage(null);
    setRunning(true);
    try {
      if (tickets.length === 0 || !ticketsCurrent) {
        await breakIntoTickets.mutateAsync({ sessionId, force: false });
      }
      if (await generateHandoffStep(false)) scrollToExportPreview();
    } catch (error: unknown) {
      reportFailure(error, "output.generateAllFailed");
    } finally {
      setRunning(false);
    }
  }

  async function confirmAndContinue() {
    setConfirmOverwrite(false);
    setRunning(true);
    try {
      if (await generateHandoffStep(true)) scrollToExportPreview();
    } catch (error: unknown) {
      reportFailure(error, "output.generateAllFailed");
    } finally {
      setRunning(false);
    }
  }

  if (!spec) return null;

  return (
    <div className="flex flex-col items-start gap-1.5" data-testid="generate-all-section">
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={busy}
        onClick={() => void run()}
        data-testid="generate-all"
      >
        {busy ? <Spinner className="size-4" /> : <IconSparkles className="size-4" />}
        {t(busy ? "output.generatingAll" : "output.generateAll")}
      </Button>
      <p className="text-xs text-muted-foreground">{t("output.generateAllHint")}</p>
      {blockedMessage ? (
        <p className="text-xs text-destructive" data-testid="generate-all-blocked">
          {blockedMessage}
        </p>
      ) : null}

      <AlertDialog open={confirmOverwrite} onOpenChange={setConfirmOverwrite}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("output.regenerateHandoffTitle")}</AlertDialogTitle>
            <AlertDialogDescription>{t("output.regenerateHandoffDescription")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("workspace.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              disabled={busy}
              onClick={() => void confirmAndContinue()}
              data-testid="confirm-regenerate-handoff-all"
            >
              {t("output.regenerateHandoffConfirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
