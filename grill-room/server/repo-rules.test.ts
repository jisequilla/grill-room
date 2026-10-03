import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { useTempGitRepos } from "../test/git-repos.js";
import { collectRuleSources, rulesForFiles, type RuleSource } from "./repo-rules.js";

const repos = useTempGitRepos();
const outsideFolders: string[] = [];

afterEach(() => {
  for (const folder of outsideFolders.splice(0)) fs.rmSync(folder, { recursive: true, force: true });
});

function repo(files: Record<string, string>): string {
  return repos.create({ files, commit: false });
}

function pathsOf(root: string): string[] {
  return collectRuleSources(root).map((source) => source.path);
}

function globsOf(text: string): string[] | null {
  const root = repo({ ".claude/rules/r.md": text });
  return collectRuleSources(root)[0]!.globs;
}

describe("collectRuleSources", () => {
  it("lists CLAUDE.md, AGENTS.md, then the rule files sorted, at any depth", () => {
    const root = repo({
      "CLAUDE.md": "c\n",
      "AGENTS.md": "a\n",
      ".claude/rules/b.md": "b\n",
      ".claude/rules/a.md": "a\n",
      ".claude/rules/sub/c.md": "c\n",
    });
    expect(pathsOf(root)).toEqual([
      "CLAUDE.md",
      "AGENTS.md",
      ".claude/rules/a.md",
      ".claude/rules/b.md",
      ".claude/rules/sub/c.md",
    ]);
  });

  it("ignores non-Markdown rule files and CLAUDE.md or AGENTS.md below the root", () => {
    const root = repo({
      ".claude/rules/notes.txt": "x\n",
      "src/CLAUDE.md": "x\n",
      "docs/AGENTS.md": "x\n",
    });
    expect(pathsOf(root)).toEqual([]);
  });

  it("returns nothing with no CLAUDE.md, no AGENTS.md and no .claude", () => {
    expect(pathsOf(repo({ "src/a.ts": "a\n" }))).toEqual([]);
  });

  it("returns AGENTS.md alone when CLAUDE.md is a symlink to it", () => {
    const root = repo({ "AGENTS.md": "a\n" });
    fs.symlinkSync("AGENTS.md", path.join(root, "CLAUDE.md"));
    expect(pathsOf(root)).toEqual(["AGENTS.md"]);
  });

  it("leaves out a rule symlinked to a file outside the repository", () => {
    const root = repo({ ".claude/rules/keep.txt": "x\n" });
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), "repo-rules-outside-"));
    outsideFolders.push(outside);
    fs.writeFileSync(path.join(outside, "x.md"), "x\n");
    fs.symlinkSync(path.join(outside, "x.md"), path.join(root, ".claude/rules/x.md"));
    expect(pathsOf(root)).toEqual([]);
  });

  it("sorts rule files by the name found in the folder, keeping the real path", () => {
    const root = repo({ "docs/a.md": "a\n", ".claude/rules/m.md": "m\n" });
    fs.symlinkSync("../../docs/a.md", path.join(root, ".claude/rules/z.md"));
    expect(pathsOf(root)).toEqual([".claude/rules/m.md", "docs/a.md"]);
  });

  it("accepts a .md name whose symlink target has another name", () => {
    const root = repo({ "notes.txt": "n\n", ".claude/rules/keep.txt": "k\n" });
    fs.symlinkSync("../../notes.txt", path.join(root, ".claude/rules/x.md"));
    expect(pathsOf(root)).toEqual(["notes.txt"]);
  });

  it("skips RULE.MD and a folder named dir.md", () => {
    const root = repo({ ".claude/rules/RULE.MD": "x\n" });
    fs.mkdirSync(path.join(root, ".claude/rules/dir.md"));
    expect(pathsOf(root)).toEqual([]);
  });

  it("does not follow a symlinked folder inside .claude/rules", () => {
    const root = repo({ "elsewhere/c.md": "c\n", ".claude/rules/keep.txt": "k\n" });
    fs.symlinkSync("../../elsewhere", path.join(root, ".claude/rules/sub"));
    expect(pathsOf(root)).toEqual([]);
  });

  it("makes one entry at CLAUDE.md's position when a rule links to it", () => {
    const root = repo({ "CLAUDE.md": "c\n", ".claude/rules/keep.txt": "k\n" });
    fs.symlinkSync("../../CLAUDE.md", path.join(root, ".claude/rules/r.md"));
    expect(pathsOf(root)).toEqual(["CLAUDE.md"]);
  });

  it("follows .claude/rules itself when it links to a folder inside the repository", () => {
    const root = repo({ "docs/rules/a.md": "a\n" });
    fs.mkdirSync(path.join(root, ".claude"));
    fs.symlinkSync("../docs/rules", path.join(root, ".claude/rules"));
    expect(pathsOf(root)).toEqual(["docs/rules/a.md"]);
  });

  it("leaves out .claude/rules when it links to a folder outside the repository", () => {
    const root = repo({ "CLAUDE.md": "c\n" });
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), "repo-rules-outside-"));
    outsideFolders.push(outside);
    fs.writeFileSync(path.join(outside, "a.md"), "a\n");
    fs.mkdirSync(path.join(root, ".claude"));
    fs.symlinkSync(outside, path.join(root, ".claude/rules"));
    expect(pathsOf(root)).toEqual(["CLAUDE.md"]);
  });

  it("leaves out .claude/rules/.env.md, which matches a secret pattern", () => {
    expect(pathsOf(repo({ ".claude/rules/.env.md": "x\n" }))).toEqual([]);
  });

  it("counts AGENTS.md of a, b and a trailing newline as 2 lines", () => {
    const root = repo({ "AGENTS.md": "a\nb\n" });
    expect(collectRuleSources(root)[0]!.lineCount).toBe(2);
  });
});

describe("paths: frontmatter", () => {
  it("is null for a file with no frontmatter", () => {
    expect(globsOf("# Rule\n")).toBeNull();
  });

  it("reads ngine-monitor's versioning.md list form", () => {
    const root = repo({
      ".claude/rules/versioning.md":
        '---\npaths:\n  - "VERSION"\n  - "web/**/*"\n  - "server/**/*"\n  - "consumers/**/*"\n---\n# Rule\n',
    });
    expect(collectRuleSources(root)[0]!.globs).toEqual([
      "VERSION",
      "web/**/*",
      "server/**/*",
      "consumers/**/*",
    ]);
  });

  it("reads a quoted string as one glob", () => {
    expect(globsOf('---\npaths: "src/**"\n---\n')).toEqual(["src/**"]);
  });

  it("reads a bare string as one glob", () => {
    expect(globsOf("---\npaths: src/**\n---\n")).toEqual(["src/**"]);
  });

  it("reads a flow list with a trailing comment", () => {
    expect(globsOf('---\npaths: ["src/**/*.{ts,tsx}", "x"] # c\n---\n')).toEqual([
      "src/**/*.{ts,tsx}",
      "x",
    ]);
  });

  it("drops empty items and ignores comments in a list", () => {
    expect(globsOf('---\npaths:\n  - "a/**"  # why\n  - ""\n---\n')).toEqual(["a/**"]);
  });

  it("keeps a comma-separated string as one glob", () => {
    expect(globsOf("---\npaths: a/**, b/**\n---\n")).toEqual(["a/**, b/**"]);
  });

  it("is null for a bare value starting with *", () => {
    expect(globsOf("---\npaths:\n  - **/*.ts\n---\n")).toBeNull();
  });

  it("is null for an unclosed flow list", () => {
    expect(globsOf("---\npaths: [a/**\n---\n")).toBeNull();
  });

  it("is null for a duplicate paths key", () => {
    expect(globsOf('---\npaths: "a/**"\npaths: "b/**"\n---\n')).toBeNull();
  });

  it("is null when paths is not top-level", () => {
    expect(globsOf('---\nother:\n  paths: "a/**"\n---\n')).toBeNull();
  });

  it("is null for an empty list", () => {
    expect(globsOf("---\npaths: []\n---\n")).toBeNull();
  });

  it("reads CRLF line endings", () => {
    expect(globsOf("---\r\npaths:\r\n  - web/**\r\n---\r\n")).toEqual(["web/**"]);
  });

  it("ignores a leading byte order mark", () => {
    expect(globsOf('﻿---\npaths: "a/**"\n---\n')).toEqual(["a/**"]);
  });

  it("is null when the frontmatter has no paths key", () => {
    expect(globsOf("---\ndescription: x\n---\n")).toBeNull();
  });

  it("is null for an empty paths value", () => {
    expect(globsOf("---\npaths:\n---\n")).toBeNull();
  });

  it("is null without a closing line", () => {
    expect(globsOf('---\npaths:\n  - "a/**"\n# no closing line\n')).toBeNull();
  });

  it("is null when the frontmatter is not on line 1", () => {
    expect(globsOf('# Title\n---\npaths: "a/**"\n---\n')).toBeNull();
  });
});

function source(pathName: string, globs: string[] | null): RuleSource {
  return { path: pathName, globs, lineCount: 1 };
}

describe("rulesForFiles", () => {
  const versioning = source(".claude/rules/versioning.md", [
    "VERSION",
    "web/**/*",
    "server/**/*",
    "consumers/**/*",
  ]);
  const claude = source("CLAUDE.md", null);

  it("matches ngine-monitor's versioning rule to a consumers migration", () => {
    expect(
      rulesForFiles([claude, versioning], ["consumers/db-writer/migrations/001.sql", "docs/x.md"]),
    ).toEqual({
      globMatched: [
        { path: ".claude/rules/versioning.md", files: ["consumers/db-writer/migrations/001.sql"] },
      ],
      unconditional: ["CLAUDE.md"],
    });
  });

  it("lists only the unconditional source when no file matches", () => {
    expect(rulesForFiles([claude, versioning], ["docs/x.md"])).toEqual({
      globMatched: [],
      unconditional: ["CLAUDE.md"],
    });
  });

  it("lists the unconditional source even with no files", () => {
    expect(rulesForFiles([claude, versioning], [])).toEqual({
      globMatched: [],
      unconditional: ["CLAUDE.md"],
    });
  });

  it("expands braces and carries only the matched files", () => {
    expect(
      rulesForFiles([source("r.md", ["src/**/*.{ts,tsx}"])], ["src/a/b.tsx", "src/c.css"]),
    ).toEqual({ globMatched: [{ path: "r.md", files: ["src/a/b.tsx"] }], unconditional: [] });
  });

  it("does not match VERSION against web/VERSION", () => {
    expect(rulesForFiles([source("r.md", ["VERSION"])], ["web/VERSION"]).globMatched).toEqual([]);
  });

  it("lists two matching sources in order, each with the file", () => {
    expect(
      rulesForFiles([source("r.md", ["a/**"]), source("s.md", ["a/x.ts"])], ["a/x.ts"]).globMatched,
    ).toEqual([
      { path: "r.md", files: ["a/x.ts"] },
      { path: "s.md", files: ["a/x.ts"] },
    ]);
  });

  it("lets ** cover dot-paths", () => {
    expect(
      rulesForFiles([source("r.md", ["web/**/*"])], ["web/.env.example", "web/src/a.ts"]).globMatched,
    ).toEqual([{ path: "r.md", files: ["web/.env.example", "web/src/a.ts"] }]);
  });

  it("drops a leading ./ from a glob", () => {
    expect(rulesForFiles([source("r.md", ["./src/**"])], ["src/a.ts"]).globMatched).toEqual([
      { path: "r.md", files: ["src/a.ts"] },
    ]);
  });

  it("is case-sensitive", () => {
    expect(rulesForFiles([source("r.md", ["src/**"])], ["SRC/a.ts"]).globMatched).toEqual([]);
  });

  it("treats empty globs as unconditional", () => {
    expect(rulesForFiles([source("r.md", [])], ["a.ts"])).toEqual({
      globMatched: [],
      unconditional: ["r.md"],
    });
  });

  it("passes a leading ! unchanged, so picomatch reads it as negation", () => {
    expect(rulesForFiles([source("r.md", ["!src/**"])], ["a.ts"]).globMatched).toEqual([
      { path: "r.md", files: ["a.ts"] },
    ]);
  });

  it("keeps the sources' order in both lists", () => {
    expect(
      rulesForFiles(
        [source("v.md", ["a/**"]), source("CLAUDE.md", null), source("w.md", ["a/**"])],
        ["a/x"],
      ),
    ).toEqual({
      globMatched: [
        { path: "v.md", files: ["a/x"] },
        { path: "w.md", files: ["a/x"] },
      ],
      unconditional: ["CLAUDE.md"],
    });
  });
});
