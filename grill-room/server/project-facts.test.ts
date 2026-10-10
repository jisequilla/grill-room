import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { useTempGitRepos } from "../test/git-repos.js";
import { collectProjectFacts, detectAdrConvention } from "./project-facts.js";

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

  it("reports the ADR convention of the decisions folder", async () => {
    const withFolder = repos.create({ files: { "docs/adr/0001-a.md": "## Context\n" } });
    const withoutFolder = repos.create({ files: { "a.txt": "1\n" } });

    const result = facts(await collectProjectFacts(withFolder));
    expect(result.adrConvention).toEqual(detectAdrConvention(withFolder, "docs/adr"));
    expect(result.adrConvention).toEqual({
      folder: "docs/adr",
      numbering: { prefix: "", width: 4, nextNumber: "0002", example: "0001-a.md" },
      template: { source: "docs/adr/0001-a.md", headings: ["Context"] },
    });
    expect(facts(await collectProjectFacts(withoutFolder)).adrConvention).toBeNull();
  });

  describe("decisionFiles", () => {
    it("lists tracked decisions.md files at several depths, sorted by path", async () => {
      const root = repos.create({
        files: {
          "decisions.md": "# root\n",
          "packages/api/decisions.md": "# api\n",
          "packages/api/nested/deep/decisions.md": "# deep\n",
          "docs/decisions.md": "# docs\n",
        },
      });

      const result = facts(await collectProjectFacts(root));

      expect(result.decisionFiles).toEqual([
        "decisions.md",
        "docs/decisions.md",
        "packages/api/decisions.md",
        "packages/api/nested/deep/decisions.md",
      ]);
    });

    it("does not list an untracked decisions.md", async () => {
      const root = repos.create({ files: { "tracked/decisions.md": "# tracked\n" } });
      await fs.writeFile(path.join(root, "untracked-decisions.md"), "# untracked\n");
      // An untracked decisions.md, added to disk after the commit.
      const untrackedDir = path.join(root, "loose");
      await fs.mkdir(untrackedDir, { recursive: true });
      await fs.writeFile(path.join(untrackedDir, "decisions.md"), "# loose\n");

      const result = facts(await collectProjectFacts(root));

      expect(result.decisionFiles).toEqual(["tracked/decisions.md"]);
    });

    it("leaves out files under the excluded folder, matching on the path segment boundary", async () => {
      const root = repos.create({
        files: {
          ".scratch/a/decisions.md": "# a\n",
          ".scratch/ab/decisions.md": "# ab\n",
          "kept/decisions.md": "# kept\n",
        },
      });

      const result = facts(await collectProjectFacts(root, [".scratch/a"]));

      expect(result.decisionFiles).toEqual([".scratch/ab/decisions.md", "kept/decisions.md"]);
    });

    it("excludes a decisions.md that is exactly the excluded folder", async () => {
      // decisions.md is a file, not a folder, but the boundary check must
      // still treat an exact path match as excluded, not just a prefix.
      const root = repos.create({ files: { "bundle/decisions.md": "# bundle\n" } });

      const result = facts(await collectProjectFacts(root, ["bundle/decisions.md"]));

      expect(result.decisionFiles).toEqual([]);
    });

    it("leaves out a decisions.md under each of the excluded folders, keeping one outside both", async () => {
      const root = repos.create({
        files: {
          "docs/specs/a/decisions.md": "# durable\n",
          ".grill-room/a/decisions.md": "# working\n",
          "docs/specs/b/decisions.md": "# another session\n",
        },
      });

      const result = facts(
        await collectProjectFacts(root, ["docs/specs/a", ".grill-room/a"]),
      );

      expect(result.decisionFiles).toEqual(["docs/specs/b/decisions.md"]);
    });

    it("gets an empty list when a project has no decisions.md", async () => {
      const root = repos.create();

      const result = facts(await collectProjectFacts(root));

      expect(result.decisionFiles).toEqual([]);
    });
  });
});

describe("detectAdrConvention", () => {
  const roots: string[] = [];

  afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
  });

  async function aRoot(): Promise<string> {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "grill-room-adr-"));
    roots.push(root);
    return root;
  }

  /** A root whose `docs/adr` holds the given files (name to content). */
  async function withAdrFolder(files: Record<string, string>): Promise<string> {
    const root = await aRoot();
    const folder = path.join(root, "docs", "adr");
    await fs.mkdir(folder, { recursive: true });
    for (const [name, content] of Object.entries(files)) {
      await fs.writeFile(path.join(folder, name), content);
    }
    return root;
  }

  const FOLDER = "docs/adr";
  const NOTHING = { folder: FOLDER, numbering: null, template: null };

  it("is null when there is no decisions folder", async () => {
    expect(detectAdrConvention(await aRoot(), null)).toBeNull();
  });

  it("reads nothing from a folder with no markdown files", async () => {
    const root = await withAdrFolder({ "notes.txt": "## Context\n" });
    expect(detectAdrConvention(root, FOLDER)).toEqual(NOTHING);
  });

  it("reads nothing from a folder that is a symlink out of the repository", async () => {
    const root = await aRoot();
    const outside = await aRoot();
    await fs.writeFile(path.join(outside, "0001-a.md"), "## Context\n");
    await fs.mkdir(path.join(root, "docs"));
    await fs.symlink(outside, path.join(root, "docs", "adr"));
    expect(detectAdrConvention(root, FOLDER)).toEqual(NOTHING);
  });

  it("reads nothing from a folder that cannot be listed", async () => {
    const root = await aRoot();
    expect(detectAdrConvention(root, FOLDER)).toEqual(NOTHING);
  });

  it("reads plain four-digit numbering and the highest file's headings", async () => {
    const root = await withAdrFolder({
      "0001-use-x.md": "# One\n",
      "0002-y.md": "## Context\n## Decision\n",
    });
    expect(detectAdrConvention(root, FOLDER)).toEqual({
      folder: FOLDER,
      numbering: { prefix: "", width: 4, nextNumber: "0003", example: "0002-y.md" },
      template: { source: "docs/adr/0002-y.md", headings: ["Context", "Decision"] },
    });
  });

  it("reads a prefix with a three-digit number", async () => {
    const root = await withAdrFolder({
      "NMON-012-read-model.md": "## A\n",
      "NMON-019-labels.md": "## B\n",
    });
    expect(detectAdrConvention(root, FOLDER)).toEqual({
      folder: FOLDER,
      numbering: {
        prefix: "NMON-",
        width: 3,
        nextNumber: "NMON-020",
        example: "NMON-019-labels.md",
      },
      template: { source: "docs/adr/NMON-019-labels.md", headings: ["B"] },
    });
  });

  it("reads a lowercase prefix on a name that is only the number", async () => {
    const root = await withAdrFolder({ "adr-001.md": "## A\n", "adr-002.md": "## B\n" });
    expect(detectAdrConvention(root, FOLDER)).toEqual({
      folder: FOLDER,
      numbering: { prefix: "adr-", width: 3, nextNumber: "adr-003", example: "adr-002.md" },
      template: { source: "docs/adr/adr-002.md", headings: ["B"] },
    });
  });

  it("takes the width of the highest file when widths differ", async () => {
    const root = await withAdrFolder({ "1-a.md": "## A\n", "12-b.md": "## B\n" });
    expect(detectAdrConvention(root, FOLDER)).toEqual({
      folder: FOLDER,
      numbering: { prefix: "", width: 2, nextNumber: "13", example: "12-b.md" },
      template: { source: "docs/adr/12-b.md", headings: ["B"] },
    });
  });

  it("takes the width of the highest file, not the widest number", async () => {
    const root = await withAdrFolder({ "001-a.md": "## A\n", "12-b.md": "## B\n" });
    expect(detectAdrConvention(root, FOLDER)).toEqual({
      folder: FOLDER,
      numbering: { prefix: "", width: 2, nextNumber: "13", example: "12-b.md" },
      template: { source: "docs/adr/12-b.md", headings: ["B"] },
    });
  });

  it("carries a number across a digit boundary", async () => {
    const root = await withAdrFolder({ "0009-a.md": "## A\n", "0010-b.md": "## B\n" });
    const convention = detectAdrConvention(root, FOLDER);
    expect(convention?.numbering).toMatchObject({ width: 4, nextNumber: "0011" });
    expect(convention?.template?.source).toBe("docs/adr/0010-b.md");
  });

  it("detects no numbering when the prefixes differ", async () => {
    const root = await withAdrFolder({ "0001-a.md": "## A\n", "NMON-002-b.md": "## B\n" });
    expect(detectAdrConvention(root, FOLDER)).toEqual(NOTHING);
  });

  it("takes the template from a template file", async () => {
    const root = await withAdrFolder({
      "0001-a.md": "## Other\n",
      "template.md": "## Status\n## Context\n",
    });
    expect(detectAdrConvention(root, FOLDER)).toEqual({
      folder: FOLDER,
      numbering: { prefix: "", width: 4, nextNumber: "0002", example: "0001-a.md" },
      template: { source: "docs/adr/template.md", headings: ["Status", "Context"] },
    });
  });

  it("does not number a template file", async () => {
    const root = await withAdrFolder({
      "0000-template.md": "## Status\n",
      "0001-a.md": "## Other\n",
    });
    expect(detectAdrConvention(root, FOLDER)).toEqual({
      folder: FOLDER,
      numbering: { prefix: "", width: 4, nextNumber: "0002", example: "0001-a.md" },
      template: { source: "docs/adr/0000-template.md", headings: ["Status"] },
    });
  });

  it("does not number a template file that outranks the real files", async () => {
    const root = await withAdrFolder({
      "0002-template.md": "## Status\n",
      "0001-a.md": "## Other\n",
    });
    expect(detectAdrConvention(root, FOLDER)).toEqual({
      folder: FOLDER,
      numbering: { prefix: "", width: 4, nextNumber: "0002", example: "0001-a.md" },
      template: { source: "docs/adr/0002-template.md", headings: ["Status"] },
    });
  });

  it("detects nothing from README and index files", async () => {
    const root = await withAdrFolder({ "README.md": "## A\n", "index.md": "## B\n" });
    expect(detectAdrConvention(root, FOLDER)).toEqual(NOTHING);
  });

  it("breaks a tie by name order", async () => {
    const root = await withAdrFolder({ "0003-a.md": "## A\n", "0003-b.md": "## B\n" });
    expect(detectAdrConvention(root, FOLDER)).toEqual({
      folder: FOLDER,
      numbering: { prefix: "", width: 4, nextNumber: "0004", example: "0003-a.md" },
      template: { source: "docs/adr/0003-a.md", headings: ["A"] },
    });
  });

  it("breaks a tie between differently padded numbers by name order", async () => {
    const root = await withAdrFolder({ "01-a.md": "## A\n", "001-b.md": "## B\n" });
    expect(detectAdrConvention(root, FOLDER)).toEqual({
      folder: FOLDER,
      numbering: { prefix: "", width: 3, nextNumber: "002", example: "001-b.md" },
      template: { source: "docs/adr/001-b.md", headings: ["B"] },
    });
  });

  it("does not fall back past a template file with no headings", async () => {
    const root = await withAdrFolder({
      "0001-a.md": "## Context\n",
      "template.md": "no headings\n",
    });
    expect(detectAdrConvention(root, FOLDER)).toEqual({
      folder: FOLDER,
      numbering: { prefix: "", width: 4, nextNumber: "0002", example: "0001-a.md" },
      template: null,
    });
  });

  it("gives a template without numbering when the prefixes are mixed", async () => {
    const root = await withAdrFolder({
      "0001-a.md": "## A\n",
      "NMON-002-b.md": "## B\n",
      "template.md": "## Status\n",
    });
    expect(detectAdrConvention(root, FOLDER)).toEqual({
      folder: FOLDER,
      numbering: null,
      template: { source: "docs/adr/template.md", headings: ["Status"] },
    });
  });

  it("picks the first template file in code-unit name order", async () => {
    const root = await withAdrFolder({ "Template.md": "## A\n", "a-template.md": "## B\n" });
    expect(detectAdrConvention(root, FOLDER)).toEqual({
      folder: FOLDER,
      numbering: null,
      template: { source: "docs/adr/Template.md", headings: ["A"] },
    });
  });

  it("does not number date-named files", async () => {
    const root = await withAdrFolder({
      "2024-01-15-foo.md": "## A\n",
      "2024-02-01-bar.md": "## B\n",
    });
    expect(detectAdrConvention(root, FOLDER)).toEqual(NOTHING);
  });

  it("keeps only well-formed level-two headings, read literally", async () => {
    const root = await withAdrFolder({
      "0002-a.md": "## Context\n## \n##Bad\n  ## Indented\n```\n## Fenced\n```\n",
    });
    expect(detectAdrConvention(root, FOLDER)).toEqual({
      folder: FOLDER,
      numbering: { prefix: "", width: 4, nextNumber: "0003", example: "0002-a.md" },
      template: { source: "docs/adr/0002-a.md", headings: ["Context", "Fenced"] },
    });
  });

  it("ignores a number of more than nine digits", async () => {
    const root = await withAdrFolder({ "1234567890-a.md": "## A\n", "0001-b.md": "## B\n" });
    expect(detectAdrConvention(root, FOLDER)).toEqual({
      folder: FOLDER,
      numbering: { prefix: "", width: 4, nextNumber: "0002", example: "0001-b.md" },
      template: { source: "docs/adr/0001-b.md", headings: ["B"] },
    });
  });

  it("skips a symlinked file and a subfolder", async () => {
    const root = await withAdrFolder({ "0002-b.md": "## B\n" });
    const folder = path.join(root, "docs", "adr");
    const outside = await aRoot();
    await fs.writeFile(path.join(outside, "target.md"), "## Linked\n");
    await fs.symlink(path.join(outside, "target.md"), path.join(folder, "0001-a.md"));
    await fs.mkdir(path.join(folder, "0009-sub.md"));
    expect(detectAdrConvention(root, FOLDER)).toEqual({
      folder: FOLDER,
      numbering: { prefix: "", width: 4, nextNumber: "0003", example: "0002-b.md" },
      template: { source: "docs/adr/0002-b.md", headings: ["B"] },
    });
  });

  it("does not follow a symlinked file that would change the result", async () => {
    const root = await withAdrFolder({ "0002-b.md": "## B\n" });
    const folder = path.join(root, "docs", "adr");
    const outside = await aRoot();
    await fs.writeFile(path.join(outside, "target.md"), "## Linked\n");
    await fs.symlink(path.join(outside, "target.md"), path.join(folder, "0003-a.md"));
    await fs.symlink(path.join(outside, "target.md"), path.join(folder, "template.md"));
    expect(detectAdrConvention(root, FOLDER)).toEqual({
      folder: FOLDER,
      numbering: { prefix: "", width: 4, nextNumber: "0003", example: "0002-b.md" },
      template: { source: "docs/adr/0002-b.md", headings: ["B"] },
    });
  });

  it("gives no template when the highest file has no level-two heading", async () => {
    const root = await withAdrFolder({ "0001-a.md": "## A\n", "0002-b.md": "# Only a title\n" });
    expect(detectAdrConvention(root, FOLDER)).toEqual({
      folder: FOLDER,
      numbering: { prefix: "", width: 4, nextNumber: "0003", example: "0002-b.md" },
      template: null,
    });
  });

  it("reads headings from the first 64 KiB only", async () => {
    const root = await withAdrFolder({
      "0001-a.md": `## Early\n${"x".repeat(70 * 1024)}\n## Late\n`,
    });
    expect(detectAdrConvention(root, FOLDER)?.template?.headings).toEqual(["Early"]);
  });
});
