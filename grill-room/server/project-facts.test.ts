import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { useTempGitRepos } from "../test/git-repos.js";
import { collectProjectFacts } from "./project-facts.js";

const repos = useTempGitRepos();

/** Variables that would point git at the repository running the tests instead. */
const INHERITED_REPO_VARIABLES = ["GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE"];

function git(root: string, args: string[]): void {
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const name of INHERITED_REPO_VARIABLES) delete env[name];
  execFileSync("git", ["-C", root, ...args], { env, stdio: "ignore" });
}

function commit(root: string, message: string, extraArgs: string[] = []): void {
  git(root, [
    "-c",
    "user.name=Grill Room Tests",
    "-c",
    "user.email=tests@example.invalid",
    "-c",
    "commit.gpgsign=false",
    "-c",
    "core.hooksPath=/dev/null",
    "commit",
    "-q",
    "-m",
    message,
    ...extraArgs,
  ]);
}

function addRemote(root: string, name: string, url: string): void {
  git(root, ["remote", "add", name, url]);
}

function refusalCode(outcome: object): string | undefined {
  return "refusal" in outcome
    ? (outcome as { refusal: { errorCode: string } }).refusal.errorCode
    : undefined;
}

function facts<T extends object>(outcome: T) {
  if ("refusal" in outcome) {
    throw new Error(`Expected facts, got a refusal: ${JSON.stringify(outcome)}`);
  }
  return (outcome as { facts: import("./project-facts.js").ProjectServerFacts }).facts;
}

describe("collectProjectFacts", () => {
  it("reports HEAD commit and branch, remotes, recent commit subjects, and a clean tree", async () => {
    const root = repos.create({ files: { "a.txt": "1\n" }, commit: false });
    git(root, ["add", "-A"]);
    commit(root, "first commit");
    commit(root, "second commit", ["--allow-empty"]);
    addRemote(root, "origin", "https://example.com/repo.git");

    const head = execFileSync("git", ["-C", root, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
    const branch = execFileSync("git", ["-C", root, "rev-parse", "--abbrev-ref", "HEAD"], {
      encoding: "utf8",
    }).trim();

    const outcome = await collectProjectFacts(root);
    const result = facts(outcome);

    expect(result.headCommit).toBe(head);
    expect(result.headBranch).toBe(branch);
    expect(result.dirty).toBe(false);
    expect(result.recentCommitSubjects).toEqual(["second commit", "first commit"]);
    expect(result.remotes).toEqual([
      { name: "origin", url: "https://example.com/repo.git", type: "fetch" },
      { name: "origin", url: "https://example.com/repo.git", type: "push" },
    ]);
  });

  it("caps recent commit subjects at ten, most recent first", async () => {
    const root = repos.create();
    for (let i = 1; i <= 12; i++) {
      commit(root, `commit ${i}`, ["--allow-empty"]);
    }

    const result = facts(await collectProjectFacts(root));

    expect(result.recentCommitSubjects).toHaveLength(10);
    expect(result.recentCommitSubjects[0]).toBe("commit 12");
    expect(result.recentCommitSubjects[9]).toBe("commit 3");
  });

  it("reports a dirty working tree when a tracked file changes", async () => {
    const root = repos.create({ files: { "a.txt": "1\n" } });

    await fs.writeFile(path.join(root, "a.txt"), "2\n");

    const result = facts(await collectProjectFacts(root));
    expect(result.dirty).toBe(true);
  });

  it("reports no remotes when none are configured", async () => {
    const root = repos.create();

    const result = facts(await collectProjectFacts(root));
    expect(result.remotes).toEqual([]);
  });

  it("strips userinfo from remote URLs, leaving scp-like remotes as they are", async () => {
    const root = repos.create();
    addRemote(root, "origin", "https://user:secret@example.invalid/x.git");
    addRemote(root, "mirror", "ssh://deploy@example.invalid/y.git");
    addRemote(root, "scp", "git@example.invalid:owner/z.git");

    const result = facts(await collectProjectFacts(root));
    const urls = Object.fromEntries(result.remotes.map((remote) => [remote.name, remote.url]));
    expect(urls).toEqual({
      origin: "https://example.invalid/x.git",
      mirror: "ssh://example.invalid/y.git",
      scp: "git@example.invalid:owner/z.git",
    });
    expect(JSON.stringify(result)).not.toContain("secret");
  });

  it("does not crash on a repository with no commits yet", async () => {
    // `repos.create` still writes README.md; with `commit: false` it stays
    // untracked, which is itself a fact worth getting right: an uncommitted
    // file in a commit-less repo is dirty.
    const root = repos.create({ commit: false });

    const result = facts(await collectProjectFacts(root));

    expect(result.headCommit).toBeNull();
    expect(result.headBranch).toBeNull();
    expect(result.recentCommitSubjects).toEqual([]);
    expect(result.dirty).toBe(true);
  });

  it("reports a clean working tree for a repository with no commits and nothing on disk", async () => {
    const root = repos.plainFolder();
    execFileSync("git", ["-C", root, "init", "-q"], { stdio: "ignore" });

    const result = facts(await collectProjectFacts(root));

    expect(result.headCommit).toBeNull();
    expect(result.headBranch).toBeNull();
    expect(result.dirty).toBe(false);
  });

  it("refuses a folder that is not a git repository", async () => {
    const folder = repos.plainFolder({ "notes.md": "hello\n" });

    const outcome = await collectProjectFacts(folder);

    expect(refusalCode(outcome)).toBe("not-a-repo");
  });

  describe("optional paths at the root", () => {
    it("reports agent instructions, a decisions folder, and a rules folder when present", async () => {
      const root = repos.create({
        files: {
          "AGENTS.md": "# agents\n",
          "docs/adr/0001-decision.md": "# ADR 1\n",
          ".claude/rules/worktrees.md": "# rules\n",
        },
      });

      const result = facts(await collectProjectFacts(root));

      expect(result.hasAgentInstructions).toBe(true);
      expect(result.decisionsFolder).toBe("docs/adr");
      expect(result.hasRulesFolder).toBe(true);
    });

    it("reports CLAUDE.md alone as agent instructions", async () => {
      const root = repos.create({ files: { "CLAUDE.md": "# claude\n" } });

      const result = facts(await collectProjectFacts(root));
      expect(result.hasAgentInstructions).toBe(true);
    });

    it.each([
      ["docs/decisions", "docs/decisions/0001.md"],
      ["docs/adr", "docs/adr/0001.md"],
      ["adr", "adr/0001.md"],
    ] as const)("recognises %s as a decisions folder", async (expected, file) => {
      const root = repos.create({ files: { [file]: "# decision\n" } });

      const result = facts(await collectProjectFacts(root));
      expect(result.decisionsFolder).toBe(expected);
    });

    it("reports all three as absent when none exist", async () => {
      const root = repos.create();

      const result = facts(await collectProjectFacts(root));

      expect(result.hasAgentInstructions).toBe(false);
      expect(result.decisionsFolder).toBeNull();
      expect(result.hasRulesFolder).toBe(false);
    });
  });
});
