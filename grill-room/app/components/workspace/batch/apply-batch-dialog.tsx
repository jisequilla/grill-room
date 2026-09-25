import {
  actionErrorMessage,
  useActionMutation,
  useActionQuery,
} from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import { IconAlertTriangle, IconStack2 } from "@tabler/icons-react";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { DecisionStateBadge } from "@/components/workspace/decision-state-badge";
import {
  BATCH_STATUS_LABEL_KEY,
  type BatchOutcome,
  type BatchOutcomeStatus,
} from "@/components/workspace/batch/batch-result";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import type { DecisionState } from "@/lib/decisions";
import {
  isApplicable,
  isReopenableState,
  parseBatchInput,
  resolveBatchRows,
  type BatchParseError,
  type ResolvableDecision,
  type ResolvedBatchRow,
} from "@/lib/reopen-batch-input";

type BatchResult = AgentNativeActionRegistry["apply-reopen-batch"]["result"];

/**
 * A batch is many interviewer turns long. The client helpers abort at 60 s by
 * default, which would cancel a run that was about to finish; the batch keeps
 * going on the server either way, and the progress panel is what a user who
 * closes the tab comes back to.
 */
const BATCH_TIMEOUT_MS = 60 * 60 * 1000;

const PARSE_ERROR_KEY: Record<BatchParseError, string> = {
  empty: "workspace.batchErrorEmpty",
  "bad-json": "workspace.batchErrorBadJson",
  "no-rows": "workspace.batchErrorNoRows",
};

function PreviewRow({ row }: { row: ResolvedBatchRow }) {
  const t = useT();
  const decision = row.resolved;

  if (!decision) {
    return (
      <li className="space-y-0.5 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2">
        <p className="text-sm font-medium">{row.decision}</p>
        <p className="text-xs text-destructive">
          {row.ambiguous.length > 0
            ? t("workspace.batchRowAmbiguous", {
                titles: row.ambiguous.join(", "),
              })
            : t("workspace.batchRowUnresolved")}
        </p>
      </li>
    );
  }

  const reopenable = isReopenableState(decision.state);

  return (
    <li className="space-y-1 rounded-lg border bg-background/60 px-3 py-2">
      <div className="flex flex-wrap items-center gap-1.5">
        <DecisionStateBadge state={decision.state as DecisionState} />
        <span className="text-sm leading-snug font-medium">
          {decision.questionTitle}
        </span>
      </div>
      <p className="text-xs text-muted-foreground">
        {t("workspace.batchRowAnswer", { answer: row.answer })}
      </p>
      {reopenable ? null : (
        <p className="flex items-start gap-1.5 text-xs text-owed">
          <IconAlertTriangle className="mt-px size-3.5 shrink-0" />
          {t("workspace.batchRowNotSettled")}
        </p>
      )}
    </li>
  );
}

function countBy(
  outcomes: readonly BatchOutcome[],
  status: BatchOutcomeStatus,
): number {
  return outcomes.filter((outcome) => outcome.status === status).length;
}

function Summary({ result }: { result: BatchResult }) {
  const t = useT();
  const failed = result.outcomes.find((outcome) => outcome.status === "failed");

  return (
    <div className="space-y-3" data-testid="batch-summary">
      <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
        {(
          [
            ["reopened", "workspace.batchSummaryReopened"],
            ["answered-as-card", "workspace.batchSummaryAsCard"],
            ["answered-as-loose-end", "workspace.batchSummaryAsLooseEnd"],
            ["not-reopenable", "workspace.batchSummarySkipped"],
          ] as const
        ).map(([status, key]) => (
          <div key={status} className="flex items-baseline justify-between gap-2">
            <dt className="text-muted-foreground">{t(key)}</dt>
            <dd className="tabular-nums">{countBy(result.outcomes, status)}</dd>
          </div>
        ))}
      </dl>

      {failed ? (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2">
          <p className="text-sm font-medium">
            {t("workspace.batchSummaryFailedAt", {
              position: result.failedAt ?? 0,
              title: failed.title,
            })}
          </p>
          <p className="mt-0.5 font-mono text-xs break-words text-muted-foreground">
            {failed.error?.message}
          </p>
        </div>
      ) : null}

      <ul className="space-y-1">
        {result.outcomes.map((outcome) => (
          <li key={outcome.decisionId} className="text-xs text-muted-foreground">
            {outcome.title} — {t(BATCH_STATUS_LABEL_KEY[outcome.status])}
          </li>
        ))}
      </ul>

      {result.added.length > 0 ? (
        <p className="text-xs text-muted-foreground">
          {t("workspace.batchSummaryAdded", { count: result.added.length })}
        </p>
      ) : null}
    </div>
  );
}

/**
 * Apply a list of changes decided somewhere else.
 *
 * The first real session's comparison against an existing system produced seven
 * reopens with the answers already agreed, and they were applied one HTTP call
 * at a time by the session orchestrating it
 * (`docs/design/session-retrospective.md`, finding 5). This is that, in the app:
 * paste the table, see what each row resolves to before anything is written,
 * then let the server apply them in order.
 *
 * The preview is the point. A row that names no decision, or names two, is
 * shown and has to be fixed; a row naming a decision that is not settled is
 * applied anyway, because by the time the batch reaches it an earlier item's
 * review may well have re-asked it — but it says so first.
 */
export function ApplyBatchDialog({ sessionId }: { sessionId: string }) {
  const t = useT();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [rows, setRows] = useState<ResolvedBatchRow[] | null>(null);
  const [parseError, setParseError] = useState<BatchParseError | null>(null);
  const [result, setResult] = useState<BatchResult | null>(null);

  const { data: tree } = useActionQuery(
    "get-tree",
    { sessionId },
    { enabled: open && sessionId.length > 0 },
  );

  useEffect(() => {
    if (open) return;
    setText("");
    setRows(null);
    setParseError(null);
    setResult(null);
  }, [open]);

  const { mutate, isPending } = useActionMutation("apply-reopen-batch", {
    timeoutMs: BATCH_TIMEOUT_MS,
    onSuccess: (data: BatchResult) => setResult(data),
    onError: (error: unknown) => {
      toast.error(actionErrorMessage(error) ?? t("workspace.batchFailed"));
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ["action"] });
    },
  });

  function preview() {
    const parsed = parseBatchInput(text);
    if (parsed.error) {
      setParseError(parsed.error);
      setRows(null);
      return;
    }
    setParseError(null);
    const candidates: ResolvableDecision[] = (tree?.decisions ?? []).map(
      (decision) => ({
        id: decision.id,
        key: decision.key,
        questionTitle: decision.questionTitle,
        state: decision.state,
      }),
    );
    setRows(resolveBatchRows(parsed.rows, candidates));
  }

  function apply() {
    if (!rows || !isApplicable(rows) || isPending) return;
    mutate({
      sessionId,
      items: rows.map((row) => ({
        decisionId: row.resolved?.id,
        answer: row.answer.trim(),
      })),
    });
  }

  const applicable = rows !== null && isApplicable(rows);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" variant="outline" size="sm">
          <IconStack2 className="size-4" />
          {t("workspace.batchAction")}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t("workspace.batchAction")}</DialogTitle>
          <DialogDescription>
            {result
              ? t("workspace.batchSummaryDescription")
              : t("workspace.batchDescription")}
          </DialogDescription>
        </DialogHeader>

        {result ? (
          <>
            <Summary result={result} />
            <DialogFooter>
              <Button type="button" onClick={() => setOpen(false)}>
                {t("workspace.batchClose")}
              </Button>
            </DialogFooter>
          </>
        ) : (
          <div className="space-y-4">
            <Textarea
              value={text}
              rows={8}
              autoFocus
              className="font-mono text-xs"
              placeholder={t("workspace.batchPlaceholder")}
              onChange={(event) => {
                setText(event.target.value);
                setRows(null);
                setParseError(null);
              }}
            />

            {parseError ? (
              <p className="text-sm text-destructive">
                {t(PARSE_ERROR_KEY[parseError])}
              </p>
            ) : null}

            {rows ? (
              <ul
                className="max-h-64 space-y-2 overflow-y-auto"
                data-testid="batch-preview"
              >
                {rows.map((row, index) => (
                  <PreviewRow key={`${row.decision}-${index}`} row={row} />
                ))}
              </ul>
            ) : null}

            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
                {t("workspace.cancel")}
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={text.trim().length === 0}
                onClick={preview}
              >
                {t("workspace.batchPreview")}
              </Button>
              <Button type="button" disabled={!applicable || isPending} onClick={apply}>
                {isPending && <Spinner className="size-4" />}
                {isPending
                  ? t("workspace.batchApplying")
                  : t("workspace.batchApply", { count: rows?.length ?? 0 })}
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
