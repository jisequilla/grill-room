/**
 * The shapes `apply-reopen-batch` returns, read off the action itself through
 * the generated registry rather than restated here, plus the one thing the
 * action does not return: the progress it stores on the session mid-run, which
 * arrives as the JSON string `get-session` carries.
 */

type BatchResult = AgentNativeActionRegistry["apply-reopen-batch"]["result"];

export type BatchOutcome = BatchResult["outcomes"][number];
export type BatchOutcomeStatus = BatchOutcome["status"];

/** A batch part-way through, as `gr_sessions.batch_progress_json` holds it. */
export type StoredBatchProgress = Pick<
  BatchResult,
  "total" | "completed" | "current" | "outcomes"
>;

export const BATCH_STATUS_LABEL_KEY: Record<BatchOutcomeStatus, string> = {
  reopened: "workspace.batchStatusReopened",
  "answered-as-card": "workspace.batchStatusAnsweredAsCard",
  "answered-as-loose-end": "workspace.batchStatusAnsweredAsLooseEnd",
  "not-reopenable": "workspace.batchStatusSkipped",
  failed: "workspace.batchStatusFailed",
};

/**
 * The stored progress, or null when no batch is running. The server wrote it,
 * so this only guards against a row from an older shape or a truncated write —
 * a panel that throws would take the whole workspace with it.
 */
export function parseStoredBatchProgress(
  json: string | null | undefined,
): StoredBatchProgress | null {
  if (!json) return null;
  try {
    const parsed = JSON.parse(json) as Partial<StoredBatchProgress>;
    if (typeof parsed.total !== "number") return null;
    return {
      total: parsed.total,
      completed: typeof parsed.completed === "number" ? parsed.completed : 0,
      current: parsed.current ?? null,
      outcomes: Array.isArray(parsed.outcomes) ? parsed.outcomes : [],
    };
  } catch {
    return null;
  }
}
