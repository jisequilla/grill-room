import {
  actionErrorMessage,
  callAction,
  useActionMutation,
  useActionQuery,
} from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import { IconFolderOpen, IconRefresh } from "@tabler/icons-react";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { actionErrorCode } from "@/lib/decisions";
import { ExportVisibilityReport } from "./export-visibility-report";

/** Every code `preview-export` and `export-session` refuse with, mapped to its message. */
const EXPORT_ERROR_KEY: Record<string, string> = {
  "no-project": "output.exportNoProject",
  "project-not-found": "output.exportProjectNotFound",
  "project-root-missing": "output.exportProjectRootMissing",
  "spec-missing": "output.exportSpecMissing",
  "spec-not-current": "output.exportSpecNotCurrent",
  "invalid-slug": "output.exportInvalidSlug",
  "invalid-folder-name": "output.exportInvalidFolderName",
  "export-outside-root": "output.exportOutsideRoot",
  "handoff-missing": "output.exportNeedsHandoff",
  "handoff-stale": "output.exportHandoffStale",
};

/** The export gate's reason, from `preview-export`'s `exportBlockedReason`, mapped to its message. */
const EXPORT_GATE_KEY: Record<string, string> = {
  "handoff-missing": "output.exportNeedsHandoff",
  "handoff-stale": "output.exportHandoffStale",
};

/** How long the slug must sit still before the preview is refreshed. */
const SLUG_DEBOUNCE_MS = 250;

type ExportResult = AgentNativeActionRegistry["export-session"]["result"];
type PreviewResult = AgentNativeActionRegistry["preview-export"]["result"];
type VisibilityResult = AgentNativeActionRegistry["get-export-visibility"]["result"];

function useDebounced<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);
  return debounced;
}

function PathList({ paths, testId }: { paths: readonly string[]; testId: string }) {
  return (
    <ul className="space-y-0.5 font-mono text-xs break-all text-muted-foreground" data-testid={testId}>
      {paths.map((file) => (
        <li key={file}>{file}</li>
      ))}
    </ul>
  );
}

/**
 * Explicit, project-based export: an editable slug, the exact paths the export
 * will write under the project root, then the Export button. The preview and
 * the write come from one server-side plan, so what is listed is what lands.
 */
export function ExportSection({
  sessionId,
  projectId,
}: {
  sessionId: string;
  projectId: string | null;
}) {
  const t = useT();
  const queryClient = useQueryClient();
  /** The slug as typed; null until the operator edits it, meaning "use the proposal". */
  const [slugDraft, setSlugDraft] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<ExportResult | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  /** A fresher visibility report from "Recheck visibility"; cleared whenever a new export lands. */
  const [visibilityOverride, setVisibilityOverride] = useState<VisibilityResult | null>(null);
  const [recheckingVisibility, setRecheckingVisibility] = useState(false);

  const debouncedSlug = useDebounced(slugDraft, SLUG_DEBOUNCE_MS);
  const slugBlank = slugDraft !== null && slugDraft.trim().length === 0;
  const settling = debouncedSlug !== slugDraft;

  const preview = useActionQuery<PreviewResult>(
    "preview-export",
    debouncedSlug === null || debouncedSlug.trim().length === 0
      ? { sessionId }
      : { sessionId, slug: debouncedSlug },
    {
      enabled: projectId !== null && !slugBlank,
      retry: false,
      // Keep the last preview on screen while the next slug's preview loads.
      placeholderData: (previous) => previous,
    },
  );

  const exportSession = useActionMutation("export-session", {
    onSuccess: (result: ExportResult) => {
      setLastResult(result);
      setVisibilityOverride(null);
      setExportError(null);
    },
    onError: (error: unknown) => {
      setLastResult(null);
      setVisibilityOverride(null);
      const code = actionErrorCode(error) ?? "";
      const key = EXPORT_ERROR_KEY[code];
      setExportError(key ? t(key) : (actionErrorMessage(error) ?? t("output.exportFailed")));
      if (code === "handoff-missing" || code === "handoff-stale") {
        // A stale tab: the button read as enabled from data fetched before the
        // handoff changed elsewhere. Refresh so the gate here catches up.
        void queryClient.invalidateQueries({ queryKey: ["action"] });
      }
    },
  });

  /** Re-checks the same files export-session just wrote, without exporting again. */
  async function recheckVisibility() {
    if (!lastResult) return;
    setRecheckingVisibility(true);
    try {
      const result = await callAction<VisibilityResult>(
        "get-export-visibility",
        { sessionId, slug: lastResult.slug },
        { method: "GET" },
      );
      setVisibilityOverride(result);
    } finally {
      setRecheckingVisibility(false);
    }
  }

  if (projectId === null) {
    return (
      <section id="output-export-section" className="space-y-3" data-testid="output-export-section">
        <h2 className="text-sm font-medium">{t("output.exportHeading")}</h2>
        <p className="text-sm text-muted-foreground" data-testid="export-needs-project">
          {t("output.exportNeedsProject")}
        </p>
      </section>
    );
  }

  const plan = preview.isError ? null : preview.data;
  const previewErrorKey = preview.isError
    ? EXPORT_ERROR_KEY[actionErrorCode(preview.error) ?? ""]
    : undefined;
  const previewError = preview.isError
    ? previewErrorKey
      ? t(previewErrorKey)
      : (actionErrorMessage(preview.error) ?? t("output.exportPreviewFailed"))
    : null;

  const canExport =
    plan !== undefined &&
    plan !== null &&
    !plan.exportBlocked &&
    !slugBlank &&
    !settling &&
    !preview.isFetching &&
    !exportSession.isPending;

  const gateKey = plan?.exportBlockedReason ? EXPORT_GATE_KEY[plan.exportBlockedReason] : undefined;

  function runExport() {
    if (!canExport || !plan) return;
    setExportError(null);
    exportSession.mutate({ sessionId, slug: plan.slug });
  }

  return (
    <section id="output-export-section" className="space-y-3" data-testid="output-export-section">
      <h2 className="text-sm font-medium">{t("output.exportHeading")}</h2>

      <div className="space-y-4 rounded-xl border bg-card px-5 py-4">
        {plan ? (
          <p className="text-sm" data-testid="export-project">
            <span className="text-muted-foreground">{t("output.exportProjectLabel")}: </span>
            <span className="font-medium">{plan.projectName}</span>
            <span className="font-mono text-xs text-muted-foreground">
              {" "}
              {plan.projectRoot}/{plan.exportFolder}
            </span>
          </p>
        ) : null}

        <div className="max-w-sm space-y-2">
          <Label htmlFor="export-slug">{t("output.exportSlugLabel")}</Label>
          <Input
            id="export-slug"
            value={slugDraft ?? plan?.proposedSlug ?? ""}
            onChange={(event) => {
              setSlugDraft(event.target.value);
              setLastResult(null);
            }}
            aria-invalid={slugBlank || previewErrorKey === "output.exportInvalidSlug"}
            aria-describedby="export-slug-hint"
            data-testid="export-slug-input"
          />
          <p id="export-slug-hint" className="text-xs text-muted-foreground">
            {slugBlank
              ? t("output.exportSlugRequired")
              : t("output.exportSlugHint", { pattern: plan?.slugPattern ?? "{slug}" })}
          </p>
        </div>

        {previewError ? (
          <Alert variant="destructive" data-testid="export-preview-error">
            <AlertTitle>{previewError}</AlertTitle>
          </Alert>
        ) : null}

        {!plan && !previewError && !slugBlank ? <Skeleton className="h-16 w-full" /> : null}

        {plan ? (
          <div className="space-y-2" aria-busy={preview.isFetching || settling}>
            <p className="text-xs font-medium">
              {t(plan.bundleExists ? "output.exportPreviewReplaceHeading" : "output.exportPreviewHeading")}
            </p>
            <PathList paths={plan.files} testId="export-preview-files" />
            {plan.removals.length > 0 ? (
              <>
                <p className="text-xs font-medium">{t("output.exportPreviewRemovalsHeading")}</p>
                <PathList paths={plan.removals} testId="export-preview-removals" />
              </>
            ) : null}
            {plan.trackerDiagnostic ? (
              <p className="text-xs text-amber-700 dark:text-amber-300" data-testid="export-tracker-diagnostic">
                {t("output.exportTrackerDiagnostic")}: {plan.trackerDiagnostic}
              </p>
            ) : null}
            {plan.ticketsSkippedReason ? (
              <p className="text-xs text-amber-700 dark:text-amber-300">
                {t("output.exportTicketsSkipped")}: {plan.ticketsSkippedReason}
              </p>
            ) : null}
          </div>
        ) : null}

        {gateKey ? (
          <p className="text-xs text-amber-700 dark:text-amber-300" data-testid="export-gate-message">
            {t(gateKey)}
          </p>
        ) : null}

        <Button type="button" disabled={!canExport} onClick={runExport} data-testid="export-action">
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
          <Alert data-testid="export-result">
            <AlertTitle>{t("output.exportSuccessHeading")}</AlertTitle>
            <AlertDescription className="space-y-2">
              <p className="text-xs font-medium">{t("output.exportedFilesHeading")}</p>
              <PathList paths={lastResult.written} testId="export-written-files" />
              {lastResult.removed.length > 0 ? (
                <>
                  <p className="text-xs font-medium">{t("output.exportRemovedFilesHeading")}</p>
                  <PathList paths={lastResult.removed} testId="export-removed-files" />
                </>
              ) : null}

              <div className="space-y-2 border-t pt-2">
                <ExportVisibilityReport report={visibilityOverride ?? lastResult.visibility} />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={recheckingVisibility}
                  onClick={() => void recheckVisibility()}
                  data-testid="export-visibility-recheck"
                >
                  {recheckingVisibility ? (
                    <Spinner className="size-4" />
                  ) : (
                    <IconRefresh className="size-4" />
                  )}
                  {t(
                    recheckingVisibility
                      ? "output.visibilityRechecking"
                      : "output.visibilityRecheck",
                  )}
                </Button>
              </div>
            </AlertDescription>
          </Alert>
        ) : null}
      </div>
    </section>
  );
}
