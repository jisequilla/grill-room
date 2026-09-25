import { spawn } from "node:child_process";

/**
 * Read-only git access to a repository the app does not own.
 *
 * Grill Room inspects target repos but never changes them: it does not stage,
 * commit, or write anything there. That rule is enforced here rather than left
 * to each caller — only the subcommands below can run, so a write cannot slip
 * in through a helper that was meant to read.
 *
 * git runs as a child process with an argument array, never through a shell:
 * the repository path and the paths asked about are user input.
 */
const READ_ONLY_SUBCOMMANDS = new Set([
  "rev-parse",
  "check-ignore",
  "ls-files",
  "status",
  "log",
  "remote",
]);

/**
 * `remote` is read-only only as `git remote -v`; every other form
 * (`remote add`, `remote set-url`, a bare `remote`, ...) can write to the
 * repository's configuration, so it is refused here rather than trusted to
 * the subcommand allow-list above.
 */
function isAllowedRemoteInvocation(args: string[]): boolean {
  return args.length === 2 && args[1] === "-v";
}

/**
 * `log` is read-only in every ordinary form, but `--output=<file>` (or the
 * two-argument spelling `--output <file>`) writes the log to a file instead
 * of stdout — a write this helper must not allow to slip through.
 */
function isDisallowedLogInvocation(args: string[]): boolean {
  return args.slice(1).some((arg) => arg === "--output" || arg.startsWith("--output="));
}

/** Variables that would point git at a different repository than the one named. */
const INHERITED_REPO_VARIABLES = [
  "GIT_DIR",
  "GIT_WORK_TREE",
  "GIT_INDEX_FILE",
  "GIT_OBJECT_DIRECTORY",
  "GIT_COMMON_DIR",
  "GIT_PREFIX",
];

const GIT_TIMEOUT_MS = 15_000;

export interface GitResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export interface RunGitOptions {
  /**
   * Force every pathspec argument of this call to be read literally: no
   * glob, no `:/` ("top") magic, no `:(word)` long-form magic — see
   * `GIT_LITERAL_PATHSPECS` in gitglossary(7). Pass this for a call whose
   * path arguments come from the user or the model, so a path that happens
   * to start with `:` (pathspec magic's trigger character) is matched as
   * the literal path it names rather than reinterpreted.
   *
   * `check-ignore` refuses this outright ("pathspec magic not supported by
   * this command: 'literal'"), for every argument, whether or not it starts
   * with `:` — verified against git 2.55. Requesting it for `check-ignore`
   * is refused here rather than silently breaking every call; neutralize a
   * leading `:` for that subcommand by prefixing the argument with `./`
   * instead (see `brief-grounding.ts`'s ignored-path check).
   */
  literalPathspecs?: boolean;
}

/** git is not installed, or not on the server's PATH. */
export class GitUnavailableError extends Error {
  constructor() {
    super("git is not available on this machine's PATH.");
    this.name = "GitUnavailableError";
  }
}

function childEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const name of INHERITED_REPO_VARIABLES) delete env[name];
  // `status` may refresh the index as a side effect; this tells it not to.
  env.GIT_OPTIONAL_LOCKS = "0";
  env.GIT_TERMINAL_PROMPT = "0";
  return env;
}

/**
 * Run one read-only git subcommand against `repo`. Resolves with the exit code
 * whatever it is — several subcommands answer through it, `check-ignore`
 * among them — and rejects only when git cannot be run at all, or when
 * `literalPathspecs` is requested for a subcommand that refuses it.
 */
export function runGit(
  repo: string,
  args: string[],
  options: RunGitOptions = {},
): Promise<GitResult> {
  const subcommand = args[0];
  if (!subcommand || !READ_ONLY_SUBCOMMANDS.has(subcommand)) {
    return Promise.reject(
      new Error(`Refusing to run git ${subcommand ?? ""}: only read-only subcommands are allowed.`),
    );
  }
  if (subcommand === "remote" && !isAllowedRemoteInvocation(args)) {
    return Promise.reject(
      new Error(`Refusing to run git remote ${args.slice(1).join(" ")}: only "remote -v" is allowed.`),
    );
  }
  if (subcommand === "log" && isDisallowedLogInvocation(args)) {
    return Promise.reject(
      new Error(`Refusing to run git log ${args.slice(1).join(" ")}: "--output" writes to a file.`),
    );
  }
  if (options.literalPathspecs && subcommand === "check-ignore") {
    return Promise.reject(
      new Error(
        "check-ignore refuses literal pathspec magic (GIT_LITERAL_PATHSPECS); neutralize a leading \":\" another way instead of passing literalPathspecs for it.",
      ),
    );
  }

  return new Promise((resolve, reject) => {
    const env = childEnv();
    if (options.literalPathspecs) env.GIT_LITERAL_PATHSPECS = "1";
    const child = spawn("git", ["-C", repo, ...args], {
      env,
      stdio: ["ignore", "pipe", "pipe"],
      timeout: GIT_TIMEOUT_MS,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => (stdout += chunk));
    child.stderr.on("data", (chunk: string) => (stderr += chunk));
    child.on("error", (error: NodeJS.ErrnoException) => {
      reject(error.code === "ENOENT" ? new GitUnavailableError() : error);
    });
    child.on("close", (code) => {
      resolve({ exitCode: code ?? -1, stdout, stderr });
    });
  });
}
