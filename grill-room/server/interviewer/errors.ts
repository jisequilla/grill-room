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

export class InterviewerError extends Error {
  readonly code: InterviewerErrorCode;
  /** Operator-facing context: stderr, parse failures, schema issues. */
  readonly detail: string;

  constructor(code: InterviewerErrorCode, message: string, detail = "") {
    super(message);
    this.name = "InterviewerError";
    this.code = code;
    this.detail = detail;
  }
}

export function isInterviewerError(value: unknown): value is InterviewerError {
  return value instanceof InterviewerError;
}
