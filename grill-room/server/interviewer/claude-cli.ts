import { spawn } from "node:child_process";
import { tmpdir } from "node:os";

import { InterviewerError } from "./errors.js";
import { buildPrompt } from "./prompt.js";
import { jsonSchemaFor, resultSchemas } from "./schemas.js";
import type { ResultFor } from "./schemas.js";
import type {
  BreakIntoTicketsRequest,
  FindSupersededRequest,
  Interviewer,
  InterviewerRequest,
  InterviewerTurn,
  ProposeRoundRequest,
  ReviewStaleRequest,
  SynthesizeSpecRequest,
} from "./types.js";

/** The command line invocation, as the runner receives it. */
export interface CliInvocation {
  command: string;
  args: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
}

/** What a finished invocation produced. A runner reports failures here, not by throwing. */
export interface CliOutcome {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  /** Set when the process could not be started at all. */
  spawnError?: NodeJS.ErrnoException;
}

/**
 * The seam the contract test injects. The default implementation wraps
 * `child_process.spawn`; nothing else in the adapter touches the process API.
 */
export type CliRunner = (invocation: CliInvocation) => Promise<CliOutcome>;

export interface ClaudeCliOptions {
  /** Defaults to spawning the real `claude` binary. */
  runCli?: CliRunner;
  /** The binary to spawn. */
  command?: string;
  /**
   * Where the child runs. Defaults to the OS temp directory so the interviewer
   * cannot pick up this repository's skills, settings or MCP configuration.
   */
  cwd?: string;
  /** The environment to derive the child's from. Defaults to the server's own. */
  env?: NodeJS.ProcessEnv;
}

/**
 * Environment markers Claude Code sets for its own session. A nested launch
 * fails outright unless they are removed, which happens whenever the app is
 * started from inside a Claude Code session.
 */
const NESTED_SESSION_MARKERS = ["CLAUDECODE", "CLAUDE_CODE_ENTRYPOINT"] as const;

const RATE_LIMIT_PATTERN =
  /rate limit|usage limit|too many requests|\b429\b|quota exceeded/i;
const LOGGED_OUT_PATTERN =
  /not logged in|please run \/login|\/login|invalid api key|authentication_error|unauthoriz|credentials/i;
const MISSING_CLI_PATTERN = /command not found|not found: claude|enoent/i;

function defaultRunner(invocation: CliInvocation): Promise<CliOutcome> {
  return new Promise((resolve) => {
    const child = spawn(invocation.command, invocation.args, {
      cwd: invocation.cwd,
      env: invocation.env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });

    child.on("error", (error: NodeJS.ErrnoException) => {
      resolve({ stdout, stderr, exitCode: null, spawnError: error });
    });
    child.on("close", (exitCode) => {
      resolve({ stdout, stderr, exitCode });
    });
  });
}

/** Strips the nested-session markers from a copy of the given environment. */
function childEnvironment(source: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const env = { ...source };
  for (const marker of NESTED_SESSION_MARKERS) delete env[marker];
  return env;
}

export function buildCliArgs(
  request: InterviewerRequest,
  { prompt, resume }: { prompt: string; resume: string | null },
): string[] {
  const args = [
    "-p",
    prompt,
    "--model",
    request.context.model,
    "--output-format",
    "json",
    // The empty-string form: it disables every tool. The interviewer must not
    // be able to run commands, read files, or touch the machine.
    "--allowed-tools",
    "",
    "--json-schema",
    JSON.stringify(jsonSchemaFor(request.kind)),
  ];
  if (resume) args.push("--resume", resume);
  return args;
}

/** Turns a failed invocation into the most specific error code it supports. */
function classifyFailure(outcome: CliOutcome, summary: string): InterviewerError {
  const detail = `${outcome.stderr}\n${outcome.stdout}`.trim();

  if (outcome.spawnError?.code === "ENOENT") {
    return new InterviewerError(
      "cli-missing",
      "The Claude Code command line could not be found. Install it and make sure `claude` is on the PATH.",
      outcome.spawnError.message,
    );
  }
  if (outcome.spawnError) {
    return new InterviewerError(
      "failed",
      `The Claude Code command line could not be started: ${outcome.spawnError.message}`,
      detail,
    );
  }
  if (outcome.exitCode === 127 || MISSING_CLI_PATTERN.test(detail)) {
    return new InterviewerError(
      "cli-missing",
      "The Claude Code command line could not be found. Install it and make sure `claude` is on the PATH.",
      detail,
    );
  }
  if (RATE_LIMIT_PATTERN.test(detail)) {
    return new InterviewerError(
      "rate-limited",
      "The Claude subscription is rate limited right now. This is not an interviewer failure: wait and retry the turn.",
      detail,
    );
  }
  if (LOGGED_OUT_PATTERN.test(detail)) {
    return new InterviewerError(
      "not-logged-in",
      "The Claude Code command line is not logged in. Run `claude` once and sign in, then retry.",
      detail,
    );
  }
  return new InterviewerError("failed", summary, detail);
}

interface CliEnvelope {
  structured_output?: unknown;
  session_id?: unknown;
  is_error?: unknown;
  result?: unknown;
}

/**
 * The real adapter. One command line invocation per turn, every tool disabled,
 * output constrained by the request's JSON schema and validated again on return.
 */
export function createClaudeCliInterviewer(
  options: ClaudeCliOptions = {},
): Interviewer {
  const runCli = options.runCli ?? defaultRunner;
  const command = options.command ?? "claude";
  const cwd = options.cwd ?? tmpdir();
  const sourceEnv = options.env ?? process.env;

  async function attempt(
    request: InterviewerRequest,
    { resume, primed = false }: { resume: string | null; primed?: boolean },
  ): Promise<InterviewerTurn<unknown>> {
    const prompt = buildPrompt(request, { primed });
    const outcome = await runCli({
      command,
      args: buildCliArgs(request, { prompt, resume }),
      cwd,
      env: childEnvironment(sourceEnv),
    });

    if (outcome.spawnError || outcome.exitCode !== 0) {
      throw classifyFailure(
        outcome,
        `The interviewer turn failed (exit code ${outcome.exitCode ?? "none"}).`,
      );
    }

    let envelope: CliEnvelope;
    try {
      envelope = JSON.parse(outcome.stdout) as CliEnvelope;
    } catch (error) {
      throw new InterviewerError(
        "malformed-output",
        "The interviewer returned output that is not JSON.",
        `${(error as Error).message}\n${outcome.stdout.slice(0, 2000)}`,
      );
    }

    if (envelope.is_error === true) {
      throw classifyFailure(
        outcome,
        "The interviewer reported an error for this turn.",
      );
    }

    if (typeof envelope.session_id !== "string" || !envelope.session_id) {
      throw new InterviewerError(
        "malformed-output",
        "The interviewer returned no conversation id.",
        outcome.stdout.slice(0, 2000),
      );
    }

    // Second validation: `--json-schema` constrains the model, it does not
    // guarantee the envelope carries anything usable.
    const parsed = resultSchemas[request.kind].safeParse(
      envelope.structured_output,
    );
    if (!parsed.success) {
      throw new InterviewerError(
        "malformed-output",
        "The interviewer returned a result that does not match the expected shape.",
        JSON.stringify(parsed.error.issues).slice(0, 2000),
      );
    }

    return { result: parsed.data, conversationId: envelope.session_id };
  }

  // The result is validated against `resultSchemas[request.kind]` above, which
  // is what makes the cast at each method below sound.
  async function turn(
    request: InterviewerRequest,
  ): Promise<InterviewerTurn<unknown>> {
    const resume = request.context.conversationId;
    if (!resume) return attempt(request, { resume: null });

    try {
      return await attempt(request, { resume });
    } catch (error) {
      // A conversation that cannot be resumed must never lose the interview:
      // start a fresh one, primed with the full decision history. Only a plain
      // turn failure is retried — a missing CLI, a missing login or a rate
      // limit would fail identically, and malformed output is the model's
      // answer rather than a lost conversation.
      if (error instanceof InterviewerError && error.code === "failed") {
        return attempt(request, { resume: null, primed: true });
      }
      throw error;
    }
  }

  return {
    proposeRound: (request: ProposeRoundRequest) =>
      turn(request) as Promise<InterviewerTurn<ResultFor<"propose-round">>>,
    reviewStale: (request: ReviewStaleRequest) =>
      turn(request) as Promise<InterviewerTurn<ResultFor<"review-stale">>>,
    findSuperseded: (request: FindSupersededRequest) =>
      turn(request) as Promise<InterviewerTurn<ResultFor<"find-superseded">>>,
    synthesizeSpec: (request: SynthesizeSpecRequest) =>
      turn(request) as Promise<InterviewerTurn<ResultFor<"synthesize-spec">>>,
    breakIntoTickets: (request: BreakIntoTicketsRequest) =>
      turn(request) as Promise<
        InterviewerTurn<ResultFor<"break-into-tickets">>
      >,
  };
}

/** The markers the adapter guarantees are absent from the child's environment. */
export const CLEARED_ENVIRONMENT_MARKERS = NESTED_SESSION_MARKERS;
