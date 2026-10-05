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

import { ExportFileList } from "./export-file-list";
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

/** `preview-export`'s `groundingState`, mapped to its message. */
const EXPORT_GROUNDING_STATE_KEY: Record<string, string> = {
  absent: "output.exportGroundingAbsent",
  current: "output.exportGroundingCurrent",
  stale: "output.exportGroundingStale",
};

/** `preview-export`'s `groundingStaleReason`, mapped to its message. */
const EXPORT_GROUNDING_STALE_REASON_KEY: Record<string, string> = {
  "head-moved": "output.exportGroundingStaleHeadMoved",
  "handoff-changed": "output.exportGroundingStaleHandoffChanged",
};

/** `preview-export`'s `ungroundedBriefs[].reason`, mapped to its message. */
const UNGROUNDED_BRIEF_REASON_KEY: Record<string, string> = {
  edited: "output.exportUngroundedReasonEdited",
  "no-grounding": "output.exportUngroundedReasonNoGrounding",
  "not-covered": "output.exportUngroundedReasonNotCovered",
  kept: "output.exportUngroundedReasonKept",
};

/**
 * The per-ticket ungrounded list to render, given the plan's grounding
 * state. With no grounding at all (`absent`), every brief's reason is
 * `no-grounding` — already said once by the grounding line itself — so
 * listing each of them again is pure repetition (an 18-ticket session would
 * get 18 identical lines). Collapsed there to nothing; every other state
 * (`current`, `stale`) still lists whichever briefs the plan does not write
 * grounded, since those reasons (`edited`, `not-covered`, `kept`) are each
 * informative on their own. Pure and data-only, so it is cheap to test
 * without rendering anything.
 */
export function visibleUngroundedBriefs<T extends { reason: string }>(
  groundingState: "absent" | "current" | "stale",
  ungroundedBriefs: readonly T[],
): readonly T[] {
  return groundingState === "absent" ? [] : ungroundedBriefs;
}

type DelegationProposal = PreviewResult["delegationProposals"][number];

const DELEGATION_SLOT_LABEL_KEY: Record<DelegationProposal["slot"], string> = {
  maxTicketsInFlight: "output.exportDelegationSlotMaxTicketsInFlight",
  pruneCommand: "output.exportDelegationSlotPruneCommand",
  reviewRule: "output.exportDelegationSlotReviewRule",
  preflight: "output.exportDelegationSlotPreflight",
};

/** Whether the export button is enabled. Rule conflicts are advisory and never read here. */
export function canExport({
  plan,
  slugBlank,
  settling,
  fetching,
  exporting,
}: {
  plan: PreviewResult | null | undefined;
  slugBlank: boolean;
  settling: boolean;
  fetching: boolean;
  exporting: boolean;
}): boolean {
  return (
    plan !== undefined &&
    plan !== null &&
    !plan.exportBlocked &&
    !slugBlank &&
    !settling &&
    !fetching &&
    !exporting
  );
}

type RuleConflict = PreviewResult["ruleConflicts"][number];
type AcceptedRuleConflict = PreviewResult["acceptedRuleConflicts"][number];

type Translate = (key: string, params?: Record<string, string | number>) => string;

/** A confirmed value or a proposed one: the number or command when the slot has one, nothing for a rule that is only a citation. */
function delegationValueText(entry: { value: number } | { command: string } | { citation: string }): string | null {
  if ("value" in entry) return String(entry.value);
  if ("command" in entry) return entry.command;
  return null;
}

/** The key of one open conflict's reason text: its ticket, citation and missing files, never its position. */
export function ruleConflictKey(conflict: {
  ticket: number;
  citation: string;
  missingFiles: readonly string[];
}): string {
  return `${conflict.ticket}|${conflict.citation}|${conflict.missingFiles.join(",")}`;
}

/**
 * Each open rule conflict of the grounding as one advisory line, with the way
 * out. Without `onAccept` the lines carry no controls. Export stays available.
 */
export function RuleConflictList({
  conflicts,
  t,
  reasons,
  onReasonChange,
  onAccept,
  busy,
}: {
  conflicts: readonly RuleConflict[];
  t: Translate;
  /** Reason text per line, keyed by `ruleConflictKey(conflict)`. */
  reasons?: Readonly<Record<string, string>>;
  onReasonChange?: (key: string, reason: string) => void;
  onAccept?: (ticket: number, citation: string, missingFiles: readonly string[], reason: string) => void;
  /** True while either waiver mutation runs. */
  busy?: boolean;
}) {
  return (
    <div className="space-y-1">
      <h3 className="text-xs font-medium">{t("output.exportRuleConflictsHeading")}</h3>
      <ul className="space-y-1 text-xs text-owed" data-testid="export-rule-conflicts">
        {conflicts.map((conflict, index) => {
          const key = ruleConflictKey(conflict);
          const reason = reasons?.[key] ?? "";
          return (
            <li
              key={`${key}#${index}`}
              className="space-y-1"
              data-testid={`export-rule-conflict-${conflict.ticket}-${index}`}
            >
              <span>
                {t("output.exportRuleConflict", {
                  ticket: conflict.ticket,
                  title: conflict.title,
                  citation: conflict.citation,
                  files: conflict.missingFiles.join(", "),
                })}
              </span>
              {onAccept ? (
                <span className="flex flex-wrap items-center gap-2">
                  <Input
                    type="text"
                    maxLength={500}
                    value={reason}
                    aria-label={t("output.exportRuleConflictReasonLabel")}
                    placeholder={t("output.exportRuleConflictReasonLabel")}
                    className="h-7 max-w-md text-xs"
                    data-testid={`export-rule-conflict-reason-${conflict.ticket}-${index}`}
                    onChange={(event) => onReasonChange?.(key, event.target.value)}
                  />
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={busy === true || reason.trim().length === 0}
                    data-testid={`export-rule-conflict-accept-${conflict.ticket}-${index}`}
                    onClick={() =>
                      onAccept(conflict.ticket, conflict.citation, conflict.missingFiles, reason.trim())
                    }
                  >
                    {t("output.exportRuleConflictAccept")}
                  </Button>
                </span>
              ) : null}
            </li>
          );
        })}
      </ul>
      <p className="text-xs text-muted-foreground">{t("output.exportRuleConflictsAdvice")}</p>
    </div>
  );
}

/** The conflicts the owner accepted as is, each with its reason and a Remove button. Presentational: the section holds the mutation. */
export function AcceptedRuleConflictList({
  accepted,
  t,
  onRemove,
  busy,
}: {
  accepted: readonly AcceptedRuleConflict[];
  t: Translate;
  onRemove?: (waiverId: string) => void;
  busy?: boolean;
}) {
  return (
    <div className="space-y-1">
      <h3 className="text-xs font-medium">{t("output.exportAcceptedRuleConflictsHeading")}</h3>
      <ul className="space-y-1 text-xs" data-testid="export-accepted-rule-conflicts">
        {accepted.map((conflict, index) => (
          <li
            key={conflict.waiverId + index}
            className="flex flex-wrap items-center gap-2"
            data-testid={`export-accepted-rule-conflict-${conflict.ticket}-${index}`}
          >
            <span>
              {t("output.exportAcceptedRuleConflict", {
                ticket: conflict.ticket,
                title: conflict.title,
                citation: conflict.citation,
                files: conflict.missingFiles.join(", "),
                reason: conflict.reason,
              })}
            </span>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={busy === true}
              data-testid={`export-accepted-rule-conflict-remove-${conflict.ticket}-${index}`}
              onClick={() => onRemove?.(conflict.waiverId)}
            >
              {t("output.exportRuleConflictRemove")}
            </Button>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * What the repository proposes for each delegation slot the owner has neither
 * confirmed nor dismissed, with the two controls. Presentational: the section
 * holds the mutations.
 */
export function DelegationProposalList({
  proposals,
  busySlot,
  onConfirm,
  onDismiss,
  t,
}: {
  proposals: readonly DelegationProposal[];
  busySlot: DelegationProposal["slot"] | null;
  onConfirm: (slot: DelegationProposal["slot"]) => void;
  onDismiss: (slot: DelegationProposal["slot"]) => void;
  t: Translate;
}) {
  return (
    <div className="space-y-1">
      <h3 className="text-xs font-medium">{t("output.exportDelegationHeading")}</h3>
      <ul className="space-y-2 text-xs" data-testid="export-delegation-proposals">
        {proposals.map((entry) => {
          const value = delegationValueText(entry.proposal);
          const confirmedValue = entry.confirmed ? delegationValueText(entry.confirmed) : null;
          const busy = busySlot === entry.slot;
          return (
            <li
              key={entry.slot}
              className="flex flex-wrap items-center gap-x-3 gap-y-1"
              data-testid={`export-delegation-proposal-${entry.slot}`}
            >
              <span className="font-medium">{t(DELEGATION_SLOT_LABEL_KEY[entry.slot])}</span>
              {value !== null ? (
                entry.slot === "maxTicketsInFlight" ? (
                  <span>{value}</span>
                ) : (
                  <code>{value}</code>
                )
              ) : null}
              <code className="text-muted-foreground">{entry.proposal.citation}</code>
              {entry.confirmed ? (
                <span className="text-muted-foreground">
                  {t("output.exportDelegationConfirmedNow")}{" "}
                  {confirmedValue !== null ? (
                    entry.slot === "maxTicketsInFlight" ? (
                      <span>{confirmedValue}</span>
                    ) : (
                      <code>{confirmedValue}</code>
                    )
                  ) : null}{" "}
                  <code>{entry.confirmed.citation}</code>
                </span>
              ) : null}
              <Button
                type="button"
                size="sm"
                disabled={busy}
                data-testid={`export-delegation-confirm-${entry.slot}`}
                onClick={() => onConfirm(entry.slot)}
              >
                {t("output.exportDelegationConfirm")}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={busy}
                data-testid={`export-delegation-dismiss-${entry.slot}`}
                onClick={() => onDismiss(entry.slot)}
              >
                {t("output.exportDelegationDismiss")}
              </Button>
            </li>
          );
        })}
      </ul>
      <p className="text-xs text-muted-foreground">{t("output.exportDelegationTradeoff")}</p>
    </div>
  );
}

/** How long the slug must sit still before the preview is refreshed. */
const SLUG_DEBOUNCE_MS = 250;

type ExportResult = AgentNativeActionRegistry["export-session"]["result"];
type PreviewResult = AgentNativeActionRegistry["preview-export"]["result"];
type VisibilityResult =
  AgentNativeActionRegistry["get-export-visibility"]["result"];

function useDebounced<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);
  return debounced;
}

function PathList({
  paths,
  testId,
}: {
  paths: readonly string[];
  testId: string;
}) {
  return (
    <ul
      className="space-y-0.5 font-mono text-xs break-all text-muted-foreground"
      data-testid={testId}
    >
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
  onBundlePathChange,
}: {
  sessionId: string;
  projectId: string | null;
  /**
   * Reports the bundle path (what `{{BUNDLE}}` becomes) and the durable
   * bundle path (what `{{DOCS}}` becomes) of the preview currently shown on
   * screen, or `null` for both whenever that preview is not current: the
   * slug is blank, the project is null, the query is disabled or errored, or
   * the query is showing placeholder data while the next preview loads.
   * `preview.data?.bundlePath` alone would keep reporting the previous
   * plan's path through that placeholder window.
   */
  onBundlePathChange?: (bundlePath: string | null, docsPath: string | null) => void;
}) {
  const t = useT();
  const queryClient = useQueryClient();
  /** The slug as typed; null until the operator edits it, meaning "use the proposal". */
  const [slugDraft, setSlugDraft] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<ExportResult | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  /** Project-root-relative paths of edited files ticked "overwrite/remove anyway". */
  const [overridePaths, setOverridePaths] = useState<ReadonlySet<string>>(
    new Set(),
  );
  /** A fresher visibility report from "Recheck visibility"; cleared whenever a new export lands. */
  const [visibilityOverride, setVisibilityOverride] =
    useState<VisibilityResult | null>(null);
  const [recheckingVisibility, setRecheckingVisibility] = useState(false);
  /** The reason typed on each open rule conflict, keyed by `ruleConflictKey`. */
  const [conflictReasons, setConflictReasons] = useState<Record<string, string>>({});

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
      setOverridePaths(new Set());
    },
    onError: (error: unknown) => {
      setLastResult(null);
      setVisibilityOverride(null);
      const code = actionErrorCode(error) ?? "";
      const key = EXPORT_ERROR_KEY[code];
      setExportError(
        key ? t(key) : (actionErrorMessage(error) ?? t("output.exportFailed")),
      );
      if (code === "handoff-missing" || code === "handoff-stale") {
        // A stale tab: the button read as enabled from data fetched before the
        // handoff changed elsewhere. Refresh so the gate here catches up.
        void queryClient.invalidateQueries({ queryKey: ["action"] });
      }
    },
  });

  const refreshAfterDecision = {
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["action"] });
    },
  };
  const confirmDelegation = useActionMutation("confirm-delegation-value", refreshAfterDecision);
  const dismissDelegation = useActionMutation("dismiss-delegation-proposal", refreshAfterDecision);
  const refetchPreview = () => {
    void queryClient.invalidateQueries({ queryKey: ["action"] });
  };
  const waiveConflict = useActionMutation("waive-rule-conflict", {
    onSuccess: (_result, variables) => {
      setConflictReasons((current) => {
        const rest = { ...current };
        delete rest[ruleConflictKey(variables)];
        return rest;
      });
      refetchPreview();
    },
    onError: refetchPreview,
  });
  const removeWaiver = useActionMutation("remove-rule-waiver", {
    onSuccess: refetchPreview,
    onError: refetchPreview,
  });
  const waiverBusy = waiveConflict.isPending || removeWaiver.isPending;
  const busyDelegationSlot =
    (confirmDelegation.isPending ? confirmDelegation.variables?.slot : undefined) ??
    (dismissDelegation.isPending ? dismissDelegation.variables?.slot : undefined) ??
    null;

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

  // Sits above the early return below so this hook always runs, whatever
  // `projectId` is: an effect skipped on some renders and not others would
  // change this component's hook order.
  useEffect(() => {
    if (!onBundlePathChange) return;
    const current =
      projectId !== null && !slugBlank && !preview.isError && !preview.isPlaceholderData;
    const bundlePath = current ? (preview.data?.bundlePath ?? null) : null;
    const docsPath = current ? (preview.data?.durableBundlePath ?? null) : null;
    if (bundlePath === null || docsPath === null) onBundlePathChange(null, null);
    else onBundlePathChange(bundlePath, docsPath);
  }, [
    onBundlePathChange,
    projectId,
    slugBlank,
    preview.isError,
    preview.isPlaceholderData,
    preview.data,
  ]);

  if (projectId === null) {
    return (
      <section
        id="output-export-section"
        className="space-y-3"
        data-testid="output-export-section"
      >
        <h2 className="text-sm font-medium">{t("output.exportHeading")}</h2>
        <p
          className="text-sm text-muted-foreground"
          data-testid="export-needs-project"
        >
          {t("output.exportNeedsProject")}
        </p>
      </section>
    );
  }

  const plan = preview.isError ? null : preview.data;
  const shownUngroundedBriefs = plan
    ? visibleUngroundedBriefs(plan.groundingState, plan.ungroundedBriefs)
    : [];
  const previewErrorKey = preview.isError
    ? EXPORT_ERROR_KEY[actionErrorCode(preview.error) ?? ""]
    : undefined;
  const previewError = preview.isError
    ? previewErrorKey
      ? t(previewErrorKey)
      : (actionErrorMessage(preview.error) ?? t("output.exportPreviewFailed"))
    : null;

  const exportAllowed = canExport({
    plan,
    slugBlank,
    settling,
    fetching: preview.isFetching,
    exporting: exportSession.isPending,
  });

  const gateKey = plan?.exportBlockedReason
    ? EXPORT_GATE_KEY[plan.exportBlockedReason]
    : undefined;

  function runExport() {
    if (!exportAllowed || !plan) return;
    setExportError(null);
    exportSession.mutate({
      sessionId,
      slug: plan.slug,
      overridePaths: [...overridePaths],
    });
  }

  function toggleOverride(rootRelativePath: string, override: boolean) {
    setOverridePaths((current) => {
      const next = new Set(current);
      if (override) next.add(rootRelativePath);
      else next.delete(rootRelativePath);
      return next;
    });
  }

  return (
    <section
      id="output-export-section"
      className="space-y-3"
      data-testid="output-export-section"
    >
      <h2 className="text-sm font-medium">{t("output.exportHeading")}</h2>

      <div className="space-y-4 rounded-xl border bg-card px-5 py-4">
        {plan ? (
          <p className="text-sm" data-testid="export-project">
            <span className="text-muted-foreground">
              {t("output.exportProjectLabel")}:{" "}
            </span>
            <span className="font-medium">{plan.projectName}</span>
            <span
              className="font-mono text-xs text-muted-foreground"
              data-testid="export-project-folders"
            >
              {" "}
              {plan.projectRoot}/{plan.durableExportFolder},{" "}
              {plan.projectRoot}/{plan.workingExportFolder}
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
              setOverridePaths(new Set());
            }}
            aria-invalid={
              slugBlank || previewErrorKey === "output.exportInvalidSlug"
            }
            aria-describedby="export-slug-hint"
            data-testid="export-slug-input"
          />
          <p id="export-slug-hint" className="text-xs text-muted-foreground">
            {slugBlank
              ? t("output.exportSlugRequired")
              : t("output.exportSlugHint", {
                  pattern: plan?.slugPattern ?? "{slug}",
                })}
          </p>
        </div>

        {previewError ? (
          <Alert variant="destructive" data-testid="export-preview-error">
            <AlertTitle>{previewError}</AlertTitle>
          </Alert>
        ) : null}

        {!plan && !previewError && !slugBlank ? (
          <Skeleton className="h-16 w-full" />
        ) : null}

        {plan ? (
          <div className="space-y-2" aria-busy={preview.isFetching || settling}>
            <p className="text-xs font-medium">
              {t(
                plan.bundleExists
                  ? "output.exportPreviewReplaceHeading"
                  : "output.exportPreviewHeading",
              )}
            </p>
            <ExportFileList
              files={plan.plannedWrites}
              overridePaths={overridePaths}
              onToggleOverride={toggleOverride}
              overrideLabelKey="output.exportOverwriteAnyway"
              testId="export-preview-files"
            />
            {plan.plannedRemovals.length > 0 ? (
              <>
                <p className="text-xs font-medium">
                  {t("output.exportPreviewRemovalsHeading")}
                </p>
                <ExportFileList
                  files={plan.plannedRemovals}
                  overridePaths={overridePaths}
                  onToggleOverride={toggleOverride}
                  overrideLabelKey="output.exportRemoveAnyway"
                  testId="export-preview-removals"
                />
              </>
            ) : null}
            {plan.trackerDiagnostic ? (
              <p
                className="text-xs text-owed"
                data-testid="export-tracker-diagnostic"
              >
                {t("output.exportTrackerDiagnostic")}: {plan.trackerDiagnostic}
              </p>
            ) : null}
            {plan.ticketsSkippedReason ? (
              <p className="text-xs text-owed">
                {t("output.exportTicketsSkipped")}: {plan.ticketsSkippedReason}
              </p>
            ) : null}

            <div className="space-y-1">
              <p
                className={
                  plan.groundingState === "current"
                    ? "text-xs text-muted-foreground"
                    : "text-xs text-owed"
                }
                data-testid="export-grounding-state"
                data-state={plan.groundingState}
              >
                {t("output.exportGroundingHeading")}: {t(EXPORT_GROUNDING_STATE_KEY[plan.groundingState])}
                {plan.groundingStaleReason
                  ? ` — ${t(EXPORT_GROUNDING_STALE_REASON_KEY[plan.groundingStaleReason])}`
                  : ""}
              </p>
              {shownUngroundedBriefs.length > 0 ? (
                <ul
                  className="space-y-0.5 text-xs text-owed"
                  data-testid="export-ungrounded-briefs"
                >
                  {shownUngroundedBriefs.map((entry) => (
                    <li key={entry.ticket} data-testid={`export-ungrounded-brief-${entry.ticket}`}>
                      {t("output.exportUngroundedBrief", {
                        ticket: entry.ticket,
                        reason: t(UNGROUNDED_BRIEF_REASON_KEY[entry.reason]),
                      })}
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
            {plan.ruleConflicts.length > 0 ? (
              <RuleConflictList
                conflicts={plan.ruleConflicts}
                t={t}
                reasons={conflictReasons}
                onReasonChange={(key, reason) => setConflictReasons((current) => ({ ...current, [key]: reason }))}
                onAccept={(ticket, citation, missingFiles, reason) =>
                  waiveConflict.mutate({ sessionId, ticket, citation, missingFiles: [...missingFiles], reason })
                }
                busy={waiverBusy}
              />
            ) : null}
            {plan.acceptedRuleConflicts.length > 0 ? (
              <AcceptedRuleConflictList
                accepted={plan.acceptedRuleConflicts}
                t={t}
                onRemove={(waiverId) => removeWaiver.mutate({ sessionId, waiverId })}
                busy={waiverBusy}
              />
            ) : null}
            {plan.delegationProposals.length > 0 ? (
              <DelegationProposalList
                proposals={plan.delegationProposals}
                busySlot={busyDelegationSlot}
                onConfirm={(slot) => confirmDelegation.mutate({ sessionId, slot })}
                onDismiss={(slot) => dismissDelegation.mutate({ sessionId, slot })}
                t={t}
              />
            ) : null}
          </div>
        ) : null}

        {gateKey ? (
          <p
            className="text-xs text-owed"
            data-testid="export-gate-message"
          >
            {t(gateKey)}
          </p>
        ) : null}

        <Button
          type="button"
          disabled={!exportAllowed}
          onClick={runExport}
          data-testid="export-action"
        >
          {exportSession.isPending ? (
            <Spinner className="size-4" />
          ) : (
            <IconFolderOpen className="size-4" />
          )}
          {t(
            exportSession.isPending
              ? "output.exporting"
              : "output.exportAction",
          )}
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
              <p className="text-xs font-medium">
                {t("output.exportedFilesHeading")}
              </p>
              <PathList
                paths={lastResult.written}
                testId="export-written-files"
              />
              {lastResult.removed.length > 0 ? (
                <>
                  <p className="text-xs font-medium">
                    {t("output.exportRemovedFilesHeading")}
                  </p>
                  <PathList
                    paths={lastResult.removed}
                    testId="export-removed-files"
                  />
                </>
              ) : null}
              {lastResult.kept.length > 0 ? (
                <>
                  <p className="text-xs font-medium">
                    {t("output.exportKeptFilesHeading")}
                  </p>
                  <PathList
                    paths={lastResult.kept}
                    testId="export-kept-files"
                  />
                </>
              ) : null}

              <div className="space-y-2 border-t pt-2">
                <ExportVisibilityReport
                  report={visibilityOverride ?? lastResult.visibility}
                />
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
