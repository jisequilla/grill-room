import { spawn } from "node:child_process";
import { tmpdir } from "node:os";

import { InterviewerError } from "./errors.js";
import { observeCall, schemaIssuesReason, type CallResult } from "./observe.js";
import { buildPrompt } from "./prompt.js";
import { jsonSchemaFor, resultSchemas } from "./schemas.js";
import type { ResultFor } from "./schemas.js";
import type {
  AssessReadinessRequest,
  BreakIntoTicketsRequest,
  FindSupersededRequest,
  Interviewer,
  InterviewerRequest,
  InterviewerTurn,
  ModelCallConversation,
  ModelCallObserver,
  ProposeRoundRequest,
  ReviewStaleRequest,
  ScoutProjectRequest,
  SynthesizeSpecRequest,
} from "./types.js";
import { SCOUT_MODEL } from "./types.js";

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

/**
 * The only tools a docs-folder turn may use. All three read; none writes, runs
 * a command, or reaches the network. The list is passed twice: to `--tools`,
 * which is the set of built-in tools that exist at all for this turn, and to
 * `--allowed-tools`, which is the permission allowlist that keeps them from
 * prompting. A tool named in neither cannot be called; a tool named in the
 * first but not the second would prompt, and `--permission-prompts none`
 * denies anything that prompts.
 */
export const DOCS_MODE_TOOLS = ["Read", "Grep", "Glob"] as const;

/**
 * What a docs-folder turn adds to the invocation. The folder is also the
 * child's working directory; these flags are what stops the turn reaching
 * anything else.
 *
 * - `--restricted` is the one that enforces the boundary: it confines the file
 *   tools to the working directories (`--add-dir` included), removes the
 *   command-running tools and WebFetch, and ignores the user, project and
 *   local settings files. Without it the file tools are not directory-scoped
 *   at all — the CLI has no flag that scopes a tool to a directory on its own.
 * - `--strict-mcp-config` stops the folder's own `.mcp.json` from adding
 *   servers, which `--restricted` alone does not cover.
 * - `--disable-slash-commands` stops the folder's `.claude/skills` from being
 *   loaded: skills resolve from the working directory (see
 *   `docs/spikes/claude-code-harness.md`, Q4).
 *
 * What none of these stops: a `CLAUDE.md` or `AGENTS.md` in the docs folder is
 * still auto-discovered and prepended as context. Only `--bare` skips that, and
 * `--bare` refuses the OAuth login this app's subscription auth depends on, so
 * the folder's memory files are accepted as read.
 */
function docsModeArgs(docsFolder: string): string[] {
  return [
    "--tools",
    DOCS_MODE_TOOLS.join(","),
    "--add-dir",
    docsFolder,
    "--restricted",
    "--strict-mcp-config",
    "--disable-slash-commands",
    // Nobody is at the terminal: anything that would prompt is denied rather
    // than granted or left hanging.
    "--permission-prompts",
    "none",
  ];
}

/**
 * Secret files the scout may never open, as gitignore-style name patterns
 * matched at any depth of the project: environment files, private keys and
 * certificates, and credential files.
 */
export const SCOUT_SECRET_FILE_PATTERNS = [
  ".env",
  ".env.*",
  "*.pem",
  "*.key",
  "*.p12",
  "*.pfx",
  "id_rsa*",
  "id_dsa*",
  "id_ecdsa*",
  "id_ed25519*",
  "credentials",
  "credentials.*",
  "*.credentials.json",
  ".netrc",
  ".npmrc",
  ".pypirc",
] as const;

/**
 * The permission deny rules the scout runs under, one per secret pattern. A
 * `Read` rule is what the command line enforces for every file-reading tool:
 * the file cannot be read, and Grep and Glob pass over it. Passed on the
 * command line, so `--restricted` ignoring the settings files leaves them in
 * force.
 */
export const SCOUT_DENY_RULES = [
  ...SCOUT_SECRET_FILE_PATTERNS.map((pattern) => `Read(**/${pattern})`),
  // The git directory: `.git/config` can hold credentials in a remote URL.
  "Read(**/.git/**)",
];

/**
 * The scout's invocation: always sonnet, always a conversation of its own,
 * docs mode pointed at the project root, and the secret files denied on top.
 */
function scoutCliArgs(request: ScoutProjectRequest, prompt: string): string[] {
  return [
    "-p",
    prompt,
    "--model",
    SCOUT_MODEL,
    "--output-format",
    "json",
    "--allowed-tools",
    DOCS_MODE_TOOLS.join(","),
    "--json-schema",
    JSON.stringify(jsonSchemaFor(request.kind)),
    ...docsModeArgs(request.projectRoot),
    "--disallowed-tools",
    SCOUT_DENY_RULES.join(","),
  ];
}

/** The folder a request may read, which is also where its child runs. */
function readableFolder(request: InterviewerRequest): string | null {
  return request.kind === "scout-project"
    ? request.projectRoot
    : request.context.docsFolder;
}

/** The conversation a request resumes. A scout never resumes one. */
function conversationToResume(request: InterviewerRequest): string | null {
  return request.kind === "scout-project" ? null : request.context.conversationId;
}

export function buildCliArgs(
  request: InterviewerRequest,
  { prompt, resume }: { prompt: string; resume: string | null },
): string[] {
  if (request.kind === "scout-project") return scoutCliArgs(request, prompt);
  const { docsFolder } = request.context;
  const args = [
    "-p",
    prompt,
    "--model",
    request.context.model,
    "--output-format",
    "json",
    // Without a docs folder: the empty-string form, which disables every tool.
    // The interviewer must not be able to run commands, read files, or touch
    // the machine. With one, exactly the three read tools, and nothing else.
    "--allowed-tools",
    docsFolder ? DOCS_MODE_TOOLS.join(",") : "",
    "--json-schema",
    JSON.stringify(jsonSchemaFor(request.kind)),
  ];
  if (docsFolder) args.push(...docsModeArgs(docsFolder));
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
  ): Promise<CallResult<unknown>> {
    const prompt = buildPrompt(request, { primed });
    const outcome = await runCli({
      command,
      args: buildCliArgs(request, { prompt, resume }),
      // A docs folder is the child's working directory, which is what makes it
      // the directory `--restricted` confines the file tools to.
      cwd: readableFolder(request) ?? cwd,
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
        { rawOutput: outcome.stdout, reason: "The output is not JSON." },
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
        {
          rawOutput: outcome.stdout,
          reason: "The output carries no conversation id.",
        },
      );
    }

    // Second validation: `--json-schema` constrains the model, it does not
    // guarantee the envelope carries anything usable.
    const rawOutput = JSON.stringify(envelope.structured_output ?? null);
    const parsed = resultSchemas[request.kind].safeParse(
      envelope.structured_output,
    );
    if (!parsed.success) {
      throw new InterviewerError(
        "malformed-output",
        "The interviewer returned a result that does not match the expected shape.",
        JSON.stringify(parsed.error.issues).slice(0, 2000),
        { rawOutput, reason: schemaIssuesReason(parsed.error.issues) },
      );
    }

    return {
      turn: { result: parsed.data, conversationId: envelope.session_id },
      rawOutput,
    };
  }

  // The result is validated against `resultSchemas[request.kind]` above, which
  // is what makes the cast at each method below sound.
  async function turn(
    request: InterviewerRequest,
    observer: ModelCallObserver | undefined,
  ): Promise<InterviewerTurn<unknown>> {
    const call = (
      number: number,
      conversation: ModelCallConversation,
      run: () => Promise<CallResult<unknown>>,
      fallsBack?: (error: unknown) => boolean,
    ) =>
      observeCall(
        observer,
        { requestKind: request.kind, call: number, conversation },
        run,
        fallsBack,
      );

    const resume = conversationToResume(request);
    if (!resume) {
      return call(1, "new", () => attempt(request, { resume: null }));
    }

    try {
      return await call(
        1,
        "resumed",
        () => attempt(request, { resume }),
        isLostConversation,
      );
    } catch (error) {
      // A conversation that cannot be resumed must never lose the interview:
      // start a fresh one, primed with the full decision history. Only a plain
      // turn failure is retried — a missing CLI, a missing login or a rate
      // limit would fail identically, and malformed output is the model's
      // answer rather than a lost conversation. The observer hears the failed
      // resume as a call of its own, so the extra call is never hidden.
      if (isLostConversation(error)) {
        return call(2, "primed-after-resume", () =>
          attempt(request, { resume: null, primed: true }),
        );
      }
      throw error;
    }
  }

  return {
    proposeRound: (request: ProposeRoundRequest, observer?: ModelCallObserver) =>
      turn(request, observer) as Promise<
        InterviewerTurn<ResultFor<"propose-round">>
      >,
    reviewStale: (request: ReviewStaleRequest, observer?: ModelCallObserver) =>
      turn(request, observer) as Promise<
        InterviewerTurn<ResultFor<"review-stale">>
      >,
    findSuperseded: (
      request: FindSupersededRequest,
      observer?: ModelCallObserver,
    ) =>
      turn(request, observer) as Promise<
        InterviewerTurn<ResultFor<"find-superseded">>
      >,
    synthesizeSpec: (
      request: SynthesizeSpecRequest,
      observer?: ModelCallObserver,
    ) =>
      turn(request, observer) as Promise<
        InterviewerTurn<ResultFor<"synthesize-spec">>
      >,
    breakIntoTickets: (
      request: BreakIntoTicketsRequest,
      observer?: ModelCallObserver,
    ) =>
      turn(request, observer) as Promise<
        InterviewerTurn<ResultFor<"break-into-tickets">>
      >,
    assessReadiness: (
      request: AssessReadinessRequest,
      observer?: ModelCallObserver,
    ) =>
      turn(request, observer) as Promise<
        InterviewerTurn<ResultFor<"assess-readiness">>
      >,
    scoutProject: (request: ScoutProjectRequest, observer?: ModelCallObserver) =>
      turn(request, observer) as Promise<
        InterviewerTurn<ResultFor<"scout-project">>
      >,
  };
}

/** A plain turn failure on resume: the conversation is lost, not the CLI, login or quota. */
function isLostConversation(error: unknown): boolean {
  return error instanceof InterviewerError && error.code === "failed";
}

/** The markers the adapter guarantees are absent from the child's environment. */
export const CLEARED_ENVIRONMENT_MARKERS = NESTED_SESSION_MARKERS;
