import {
  actionErrorMessage,
  useActionMutation,
  useActionQuery,
} from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import { IconFileDescription, IconPencil, IconRefresh } from "@tabler/icons-react";
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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { Markdown } from "@/components/workspace/markdown";
import { actionErrorCode } from "@/lib/decisions";

type HandoffResult = AgentNativeActionRegistry["get-handoff"]["result"];
type Handoff = NonNullable<HandoffResult["handoff"]>;

const HANDOFF_DOC = "handoff";

/** Why generation is refused, by `get-handoff`'s `cannotGenerateReason.errorCode`. */
const CANNOT_GENERATE_KEY: Record<string, string> = {
  "no-project": "output.handoffNeedsProject",
  "project-not-found": "output.handoffNeedsProject",
  "spec-missing": "output.handoffNeedsSpec",
  "no-tickets": "output.handoffNeedsTickets",
  "ticket-cycle": "output.handoffTicketCycle",
};

function briefKey(ticketNumber: number): string {
  return `brief-${ticketNumber}`;
}

function documentText(handoff: Handoff, key: string): string {
  if (key === HANDOFF_DOC) return handoff.markdown;
  return handoff.briefs.find((brief) => briefKey(brief.ticketNumber) === key)?.markdown ?? "";
}

/**
 * The session's HANDOFF.md and per-ticket briefs: generate, read, edit, and
 * regenerate them. Regenerating over edits asks first. Badges say when the
 * handoff no longer matches its inputs and when the exported copy is behind.
 */
export function HandoffSection({ sessionId }: { sessionId: string }) {
  const t = useT();
  const [selected, setSelected] = useState(HANDOFF_DOC);
  const [draft, setDraft] = useState<string | null>(null);
  const [confirmOverwrite, setConfirmOverwrite] = useState(false);

  const { data, isLoading } = useActionQuery("get-handoff", { sessionId });

  const generate = useActionMutation("generate-handoff", {
    onSuccess: () => {
      setDraft(null);
      setConfirmOverwrite(false);
    },
    onError: (error: unknown) => {
      if (actionErrorCode(error) === "handoff-edited") {
        setConfirmOverwrite(true);
        return;
      }
      toast.error(actionErrorMessage(error) ?? t("output.handoffGenerateFailed"));
    },
  });

  const update = useActionMutation("update-handoff", {
    onSuccess: () => setDraft(null),
    onError: (error: unknown) =>
      toast.error(actionErrorMessage(error) ?? t("output.handoffSaveFailed")),
  });

  if (isLoading || !data) {
    return (
      <section className="space-y-3">
        <h2 className="text-sm font-medium">{t("output.handoffHeading")}</h2>
        <Skeleton className="h-32 w-full rounded-xl" />
      </section>
    );
  }

  const handoff = data.handoff;
  const reasonKey = data.cannotGenerateReason
    ? CANNOT_GENERATE_KEY[data.cannotGenerateReason.errorCode]
    : undefined;
  const reason = data.cannotGenerateReason
    ? reasonKey
      ? t(reasonKey)
      : data.cannotGenerateReason.message
    : null;
  const busy = generate.isPending || update.isPending;

  function regenerate() {
    if (handoff?.editedAt) {
      setConfirmOverwrite(true);
      return;
    }
    generate.mutate({ sessionId });
  }

  function save() {
    if (draft === null) return;
    if (selected === HANDOFF_DOC) {
      update.mutate({ sessionId, markdown: draft });
      return;
    }
    const brief = handoff?.briefs.find((candidate) => briefKey(candidate.ticketNumber) === selected);
    if (brief) update.mutate({ sessionId, briefs: [{ ticketNumber: brief.ticketNumber, markdown: draft }] });
  }

  const activeKey =
    handoff &&
    (selected === HANDOFF_DOC ||
      handoff.briefs.some((brief) => briefKey(brief.ticketNumber) === selected))
      ? selected
      : HANDOFF_DOC;

  return (
    <section className="space-y-3" data-testid="output-handoff-section">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-sm font-medium">{t("output.handoffHeading")}</h2>
        {handoff ? (
          <div className="flex flex-wrap items-center gap-1.5">
            {handoff.stale ? (
              <Badge variant="secondary" data-testid="handoff-stale">
                {t("output.handoffStale")}
              </Badge>
            ) : (
              <Badge variant="outline">{t("output.handoffCurrent")}</Badge>
            )}
            {handoff.editedAt ? (
              <Badge variant="outline" data-testid="handoff-edited">
                {t("output.handoffEdited")}
              </Badge>
            ) : null}
            {handoff.exportStale ? (
              <Badge variant="secondary" data-testid="handoff-export-stale">
                {t("output.handoffExportStale")}
              </Badge>
            ) : null}
          </div>
        ) : null}
      </div>

      {!handoff ? (
        <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed px-6 py-10 text-center">
          <IconFileDescription className="size-6 text-muted-foreground" />
          <h3 className="text-base font-medium">{t("output.handoffEmptyTitle")}</h3>
          <p className="max-w-sm text-sm text-muted-foreground">
            {reason ?? t("output.handoffEmptyDescription")}
          </p>
          <Button
            className="mt-1"
            disabled={!data.canGenerate || busy}
            onClick={() => generate.mutate({ sessionId })}
            data-testid="generate-handoff"
          >
            {generate.isPending && <Spinner className="size-4" />}
            {t(generate.isPending ? "output.generatingHandoff" : "output.generateHandoff")}
          </Button>
        </div>
      ) : (
        <div className="space-y-3">
          {handoff.stale ? (
            <p className="text-xs text-amber-700 dark:text-amber-300">
              {reason ?? t("output.handoffStaleHint")}
            </p>
          ) : null}

          <div className="flex flex-wrap items-end justify-between gap-3">
            <div className="w-full max-w-xs space-y-1.5">
              <Label htmlFor="handoff-document">{t("output.handoffDocumentLabel")}</Label>
              <Select
                value={activeKey}
                onValueChange={(value) => {
                  setSelected(value);
                  setDraft(null);
                }}
              >
                <SelectTrigger id="handoff-document" data-testid="handoff-document">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={HANDOFF_DOC}>HANDOFF.md</SelectItem>
                  {handoff.briefs.map((brief) => (
                    <SelectItem key={brief.ticketNumber} value={briefKey(brief.ticketNumber)}>
                      {brief.relativePath}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex gap-2">
              {draft === null ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={busy}
                  onClick={() => setDraft(documentText(handoff, activeKey))}
                  data-testid="edit-handoff"
                >
                  <IconPencil className="size-4" />
                  {t("output.handoffEdit")}
                </Button>
              ) : null}
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={busy || !data.canGenerate}
                onClick={regenerate}
                data-testid="regenerate-handoff"
              >
                {generate.isPending ? <Spinner className="size-4" /> : <IconRefresh className="size-4" />}
                {t(generate.isPending ? "output.generatingHandoff" : "output.regenerateHandoff")}
              </Button>
            </div>
          </div>

          {draft === null ? (
            <div className="rounded-xl border bg-card px-5 py-4" data-testid="handoff-document-view">
              <Markdown
                text={documentText(handoff, activeKey)}
                className="text-sm leading-relaxed text-foreground"
              />
            </div>
          ) : (
            <div className="space-y-2">
              <Textarea
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                className="min-h-96 font-mono text-xs"
                aria-label={t("output.handoffDocumentLabel")}
                data-testid="handoff-editor"
              />
              <div className="flex gap-2">
                <Button type="button" size="sm" disabled={busy} onClick={save} data-testid="save-handoff">
                  {update.isPending && <Spinner className="size-4" />}
                  {t(update.isPending ? "output.handoffSaving" : "output.handoffSave")}
                </Button>
                <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => setDraft(null)}>
                  {t("workspace.cancel")}
                </Button>
              </div>
            </div>
          )}

          <p className="text-xs text-muted-foreground">{t("output.handoffBundleHint", { token: "{{BUNDLE}}" })}</p>
        </div>
      )}

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
              onClick={() => generate.mutate({ sessionId, overwriteEdits: true })}
              data-testid="confirm-regenerate-handoff"
            >
              {t("output.regenerateHandoffConfirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
