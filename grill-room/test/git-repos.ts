/**
 * Throwaway git repositories for tests that need a real one.
 *
 *     const repos = useTempGitRepos();
 *
 *     it("resolves the root", async () => {
 *       const root = repos.create({ files: { "justfile": "test:\n\techo ok\n" } });
 *       ...
 *     });
 *
 * Every folder lives under `os.tmpdir()` and is removed after each test, so no
 * test writes to the real repository. Paths come back as real paths — on macOS
 * `os.tmpdir()` sits under `/var`, which git reports as `/private/var` — so
 * they compare equal to what `git rev-parse --show-toplevel` returns.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach } from "vitest";

export interface TempRepoOptions {
  /** Files to write, keyed by path relative to the repository root. */
  files?: Record<string, string>;
  /** Contents of a `.gitignore` at the root. */
  gitignore?: string;
  /** Whether to commit the files; defaults to true. */
  commit?: boolean;
}

/** Variables that would point git at the repository running the tests instead. */
const INHERITED_REPO_VARIABLES = ["GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE"];

function git(repo: string, args: string[]): void {
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const name of INHERITED_REPO_VARIABLES) delete env[name];
  execFileSync(
    "git",
    [
      "-C",
      repo,
      "-c",
      "user.name=Grill Room Tests",
      "-c",
      "user.email=tests@example.invalid",
      "-c",
      "commit.gpgsign=false",
      "-c",
      "core.hooksPath=/dev/null",
      ...args,
    ],
    { env, stdio: "ignore" },
  );
}

function writeFiles(root: string, files: Record<string, string>): void {
  for (const [relative, contents] of Object.entries(files)) {
    const file = path.join(root, relative);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, contents);
  }
}

export function useTempGitRepos() {
  const created: string[] = [];

  afterEach(() => {
    for (const folder of created.splice(0)) {
      rmSync(folder, { recursive: true, force: true });
    }
  });

  function tempFolder(): string {
    const folder = realpathSync(mkdtempSync(path.join(os.tmpdir(), "grill-room-test-")));
    created.push(folder);
    return folder;
  }

  return {
    /** An empty folder that is not inside any git repository. */
    plainFolder(files: Record<string, string> = {}): string {
      const folder = tempFolder();
      writeFiles(folder, files);
      return folder;
    },

    /** A fresh repository with one commit holding `files` and `.gitignore`. */
    create(options: TempRepoOptions = {}): string {
      const root = tempFolder();
      git(root, ["init", "-q"]);
      const files: Record<string, string> = {
        "README.md": "# fixture\n",
        ...options.files,
      };
      if (options.gitignore !== undefined) files[".gitignore"] = options.gitignore;
      writeFiles(root, files);
      if (options.commit !== false) {
        git(root, ["add", "-A"]);
        git(root, ["commit", "-q", "-m", "fixture"]);
      }
      return root;
    },
  };
}
