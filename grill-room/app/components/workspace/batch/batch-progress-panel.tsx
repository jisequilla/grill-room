import { useActionQuery } from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import { IconStack2 } from "@tabler/icons-react";

import {
  BATCH_STATUS_LABEL_KEY,
  parseStoredBatchProgress,
  type BatchOutcome,
} from "@/components/workspace/batch/batch-result";

/** How often the panel re-reads the session while a batch is running. */
const BATCH_POLL_MS = 2000;

/**
 * A batch of reopens, while it runs.
 *
 * Every item is one or two real interviewer turns, so a batch of seven is the
 * better part of ten minutes — far longer than the request that started it will
 * be waited on, and long enough that the tab will be reloaded. The batch
 * therefore records where it is on the session itself, and this reads that
 * back: it does not know or care whether this tab is the one that started it.
 *
 * The turn panel above says what the interviewer is doing right now; this says
 * which of the user's own changes that turn belongs to.
 */
export function BatchProgressPanel({ sessionId }: { sessionId: string }) {
  const t = useT();

  const { data: session } = useActionQuery(
    "get-session",
    { id: sessionId },
    {
      enabled: sessionId.length > 0,
      refetchInterval: (query) =>
        query.state.data?.batchProgressJson ? BATCH_POLL_MS : false,
    },
  );

  const progress = parseStoredBatchProgress(session?.batchProgressJson ?? null);
  if (!progress) return null;

  const done = progress.outcomes.filter(
    (outcome: BatchOutcome) => outcome.status !== "failed",
  ).length;

  return (
    <div
      className="relative mb-4 overflow-hidden rounded-xl border bg-muted px-4 py-3"
      data-testid="batch-progress"
    >
      <span aria-hidden className="absolute inset-x-0 top-0 h-0.5 bg-primary" />
      <div className="flex items-center gap-2">
        <IconStack2 className="size-4 shrink-0 animate-pulse text-muted-foreground" />
        <span className="text-sm font-medium">
          {t("workspace.batchRunning", {
            completed: progress.completed,
            total: progress.total,
          })}
        </span>
      </div>

      {progress.current ? (
        <p className="mt-1 pl-6 text-sm text-muted-foreground">
          {t("workspace.batchCurrent", { title: progress.current.title })}
        </p>
      ) : null}

      {progress.outcomes.length > 0 ? (
        <ul className="mt-2 space-y-1 pl-6">
          {progress.outcomes.map((outcome: BatchOutcome) => (
            <li
              key={outcome.decisionId}
              className="text-xs text-muted-foreground"
            >
              {outcome.title} — {t(BATCH_STATUS_LABEL_KEY[outcome.status])}
            </li>
          ))}
        </ul>
      ) : null}

      <div
        className="mt-3 flex gap-1"
        role="img"
        aria-label={t("workspace.batchRunning", {
          completed: progress.completed,
          total: progress.total,
        })}
      >
        {Array.from({ length: progress.total }, (_, index) => (
          <span
            key={index}
            className={`h-1.5 flex-1 rounded-full ${
              index < done
                ? "bg-settled"
                : index < progress.completed
                  ? "bg-destructive"
                  : "bg-muted-foreground/25"
            }`}
          />
        ))}
      </div>
    </div>
  );
}
