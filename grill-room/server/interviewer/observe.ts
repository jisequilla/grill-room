import { InterviewerError, oneLine } from "./errors.js";
import type {
  CliMetrics,
  InterviewerTurn,
  ModelCallObserver,
  ModelCallOutcome,
  ModelCallStart,
} from "./types.js";

/**
 * The outcome a failed model call reports. `fallingBack` marks a failed resume
 * the port is about to retry as a fresh conversation: that call is a resume
 * fallback whatever the error said, because the method has not failed.
 */
export function outcomeOfFailure(
  error: unknown,
  fallingBack = false,
): ModelCallOutcome {
  if (!(error instanceof InterviewerError)) {
    return {
      kind: "error",
      code: "failed",
      reason: oneLine(error instanceof Error ? error.message : String(error)),
    };
  }
  if (fallingBack) return { kind: "resume-fallback", reason: error.reason };
  switch (error.code) {
    case "rate-limited":
      return { kind: "rate-limited", reason: error.reason };
    case "malformed-output":
      return {
        kind: "schema-invalid",
        rawOutput: error.rawOutput ?? "",
        reason: error.reason,
      };
    default:
      return { kind: "error", code: error.code, reason: error.reason };
  }
}

/** The metrics a failed model call carries, if it produced a parseable result. */
function metricsOfFailure(error: unknown): CliMetrics | undefined {
  return error instanceof InterviewerError
    ? (error.metrics ?? undefined)
    : undefined;
}

/**
 * Schema issues as one line: the first issue's path and message, and how many
 * more there were.
 */
export function schemaIssuesReason(
  issues: readonly { path: readonly PropertyKey[]; message: string }[],
): string {
  const [first] = issues;
  if (!first) return "The result does not match the expected shape.";
  const path = first.path.map(String).join(".") || "(root)";
  const more = issues.length > 1 ? ` (and ${issues.length - 1} more)` : "";
  return oneLine(`Schema mismatch at ${path}: ${first.message}${more}`);
}

/**
 * What one successful model call produced: the turn, the output it came from,
 * and what the call cost and did.
 */
export interface CallResult<Result> {
  turn: InterviewerTurn<Result>;
  rawOutput: string;
  metrics?: CliMetrics;
}

/**
 * Runs one model call and tells the observer when it starts and how it ended.
 * The call's own result or error passes through unchanged; with no observer,
 * this is just the call.
 */
export async function observeCall<Result>(
  observer: ModelCallObserver | undefined,
  start: Omit<ModelCallStart, "startedAt">,
  run: () => Promise<CallResult<Result>>,
  fallsBack: (error: unknown) => boolean = () => false,
): Promise<InterviewerTurn<Result>> {
  const started: ModelCallStart = { ...start, startedAt: new Date() };
  await observer?.callStarted?.(started);

  const end = async (
    outcome: ModelCallOutcome,
    metrics: CliMetrics | undefined,
  ): Promise<void> => {
    if (!observer?.callEnded) return;
    const endedAt = new Date();
    await observer.callEnded({
      ...started,
      endedAt,
      durationMs: endedAt.getTime() - started.startedAt.getTime(),
      outcome,
      ...(metrics ? { metrics } : {}),
    });
  };

  let result: CallResult<Result>;
  try {
    result = await run();
  } catch (error) {
    await end(outcomeOfFailure(error, fallsBack(error)), metricsOfFailure(error));
    throw error;
  }
  await end({ kind: "success", rawOutput: result.rawOutput }, result.metrics);
  return result.turn;
}
