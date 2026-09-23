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
]);

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
 * among them — and rejects only when git cannot be run at all.
 */
export function runGit(repo: string, args: string[]): Promise<GitResult> {
  const subcommand = args[0];
  if (!subcommand || !READ_ONLY_SUBCOMMANDS.has(subcommand)) {
    return Promise.reject(
      new Error(`Refusing to run git ${subcommand ?? ""}: only read-only subcommands are allowed.`),
    );
  }

  return new Promise((resolve, reject) => {
    const child = spawn("git", ["-C", repo, ...args], {
      env: childEnv(),
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
