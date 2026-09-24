/**
 * The failure vocabulary of the interviewer port. Callers distinguish these to
 * decide what the user is told: a rate limit is not a defect, a missing or
 * logged-out CLI is a setup problem, and malformed output is worth a retry.
 */
export type InterviewerErrorCode =
  /** The Claude Code command line is not installed or not on the PATH. */
  | "cli-missing"
  /** The command line is installed but has no usable login. */
  | "not-logged-in"
  /** The shared subscription pool is exhausted. Not an interviewer defect. */
  | "rate-limited"
  /** The turn produced output that is not valid against the request's schema. */
  | "malformed-output"
  /** Any other failure of the turn. */
  | "failed";

export interface InterviewerErrorExtras {
  /** What the model returned, when the failure came after it returned something. */
  rawOutput?: string;
  /** The failure in one line. Defaults to the message, flattened. */
  reason?: string;
}

export class InterviewerError extends Error {
  readonly code: InterviewerErrorCode;
  /** Operator-facing context: stderr, parse failures, schema issues. */
  readonly detail: string;
  /** The model's output, for a failure that came after output. Null when there was none. */
  readonly rawOutput: string | null;
  /** The failure in one line, short enough to show beside an attempt. */
  readonly reason: string;

  constructor(
    code: InterviewerErrorCode,
    message: string,
    detail = "",
    extras: InterviewerErrorExtras = {},
  ) {
    super(message);
    this.name = "InterviewerError";
    this.code = code;
    this.detail = detail;
    this.rawOutput = extras.rawOutput ?? null;
    this.reason = oneLine(extras.reason ?? message);
  }
}

const REASON_MAX_LENGTH = 300;

/** Collapses text to a single line short enough for an attempt log. */
export function oneLine(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length <= REASON_MAX_LENGTH
    ? flat
    : `${flat.slice(0, REASON_MAX_LENGTH - 1)}…`;
}

export function isInterviewerError(value: unknown): value is InterviewerError {
  return value instanceof InterviewerError;
}
