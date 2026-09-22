import {
  actionErrorMessage,
  useActionMutation,
  useActionQuery,
} from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import { IconFileText, IconRefresh } from "@tabler/icons-react";
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
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { Markdown } from "@/components/workspace/markdown";
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
  "invalid-spec",
  "failed",
]);

export function SpecSection({
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

  const { data, isLoading } = useActionQuery("get-spec", { sessionId });
  const spec = data?.spec ?? null;

  const synthesize = useActionMutation("synthesize-spec", {
    timeoutMs: TURN_TIMEOUT_MS,
    onError: (error: unknown) => {
      if (SILENT_ERROR_CODES.has(actionErrorCode(error) ?? "")) return;
      toast.error(actionErrorMessage(error) ?? t("output.writeSpecFailed"));
    },
    onSettled,
  });

  const busy = working || synthesize.isPending;

  if (isLoading) {
    return (
      <section className="space-y-3">
        <h2 className="text-sm font-medium">{t("output.specHeading")}</h2>
        <Skeleton className="h-40 w-full rounded-xl" />
      </section>
    );
  }

  return (
    <section className="space-y-3" data-testid="output-spec-section">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-medium">{t("output.specHeading")}</h2>
        {spec ? (
          <Badge variant={spec.current ? "outline" : "secondary"}>
            {t(spec.current ? "output.specCurrent" : "output.specOutOfDate")}
          </Badge>
        ) : null}
      </div>

      {!spec ? (
        <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed px-6 py-10 text-center">
          <IconFileText className="size-6 text-muted-foreground" />
          <h3 className="text-base font-medium">
            {t("output.specEmptyTitle")}
          </h3>
          <p className="max-w-sm text-sm text-muted-foreground">
            {t("output.specEmptyDescription")}
          </p>
          <Button
            className="mt-1"
            disabled={busy}
            onClick={() => synthesize.mutate({ sessionId })}
            data-testid="write-spec"
          >
            {synthesize.isPending && <Spinner className="size-4" />}
            {t(synthesize.isPending ? "output.writingSpec" : "output.writeSpec")}
          </Button>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="rounded-xl border bg-card px-5 py-4">
            <Markdown
              text={spec.markdown}
              className="text-sm leading-relaxed text-foreground"
            />
          </div>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={busy}
                data-testid="regenerate-spec"
              >
                {synthesize.isPending ? (
                  <Spinner className="size-4" />
                ) : (
                  <IconRefresh className="size-4" />
                )}
                {t(
                  synthesize.isPending
                    ? "output.regeneratingSpec"
                    : "output.regenerateSpec",
                )}
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>
                  {t("output.regenerateSpecTitle")}
                </AlertDialogTitle>
                <AlertDialogDescription>
                  {t("output.regenerateSpecDescription")}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>{t("workspace.cancel")}</AlertDialogCancel>
                <AlertDialogAction
                  disabled={busy}
                  onClick={() => synthesize.mutate({ sessionId })}
                >
                  {t("output.regenerateSpecConfirm")}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      )}
    </section>
  );
}
