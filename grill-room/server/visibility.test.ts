import fs from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { useTempGitRepos } from "../test/git-repos.js";
import { runGit } from "./git.js";
import { buildVisibilityReport, buildVisibilityWarnings, classifyVisibility } from "./visibility.js";

const repos = useTempGitRepos();

describe("classifyVisibility", () => {
  it("classifies tracked, ignored, and untracked files against a real repo", async () => {
    const root = repos.create({
      gitignore: "ignored-dir/\n",
      files: {
        "issues/01-tracked.md": "tracked ticket",
      },
    });
    // Written after the commit, so these never entered the index.
    await fs.mkdir(path.join(root, "ignored-dir"), { recursive: true });
    await fs.writeFile(path.join(root, "ignored-dir", "spec.md"), "ignored spec");
    await fs.writeFile(path.join(root, "issues", "99-untracked.md"), "untracked ticket");

    const files = await classifyVisibility(root, [
      path.join(root, "issues", "01-tracked.md"),
      path.join(root, "ignored-dir", "spec.md"),
      path.join(root, "issues", "99-untracked.md"),
    ]);

    expect(files).toEqual([
      { path: path.join(root, "issues", "01-tracked.md"), relativePath: "issues/01-tracked.md", visibility: "tracked" },
      { path: path.join(root, "ignored-dir", "spec.md"), relativePath: "ignored-dir/spec.md", visibility: "ignored" },
      { path: path.join(root, "issues", "99-untracked.md"), relativePath: "issues/99-untracked.md", visibility: "untracked" },
    ]);
  });

  it("classifies a path that does not exist on disk yet, by pattern alone", async () => {
    const root = repos.create({ gitignore: ".scratch/\n" });

    const files = await classifyVisibility(root, [
      path.join(root, ".scratch", "05-feature", "spec.md"),
    ]);

    expect(files).toEqual([
      {
        path: path.join(root, ".scratch", "05-feature", "spec.md"),
        relativePath: ".scratch/05-feature/spec.md",
        visibility: "ignored",
      },
    ]);
  });

  it("returns an empty list for no paths, without calling git", async () => {
    expect(await classifyVisibility("/nonexistent", [])).toEqual([]);
  });

  it("never changes the target repository's git state", async () => {
    const root = repos.create({
      gitignore: "ignored-dir/\n",
      files: { "issues/01-tracked.md": "tracked" },
    });
    await fs.mkdir(path.join(root, "ignored-dir"), { recursive: true });
    await fs.writeFile(path.join(root, "ignored-dir", "spec.md"), "ignored");
    await fs.writeFile(path.join(root, "untracked.md"), "untracked");

    const before = await runGit(root, ["status", "--porcelain", "--ignored"]);

    await classifyVisibility(root, [
      path.join(root, "issues", "01-tracked.md"),
      path.join(root, "ignored-dir", "spec.md"),
      path.join(root, "untracked.md"),
    ]);

    const after = await runGit(root, ["status", "--porcelain", "--ignored"]);
    expect(after.stdout).toBe(before.stdout);
  });

  it("refuses any git subcommand that could write, even from this module's own repo handle", async () => {
    const root = repos.create();
    await expect(runGit(root, ["commit", "-m", "nope"])).rejects.toThrow(/read-only/);
    await expect(runGit(root, ["add", "."])).rejects.toThrow(/read-only/);
  });
});

describe("buildVisibilityWarnings", () => {
  const root = "/repo";
  const bundleRelativePath = ".scratch/05-feature";

  function file(relativePath: string, visibility: "tracked" | "ignored" | "untracked") {
    return { path: `/repo/${relativePath}`, relativePath, visibility };
  }

  it("warns about nothing when every file is tracked and the flag says tracked", () => {
    const result = buildVisibilityWarnings({
      root,
      bundleRelativePath,
      files: [file("spec.md", "tracked"), file("issues/01-a.md", "tracked")],
      visibility: "tracked",
    });

    expect(result).toEqual({
      hasUntracked: false,
      hasIgnored: false,
      warning: null,
      untrackedRemedy: null,
      ignoredRemedy: null,
      mismatchWarning: null,
    });
  });

  it("warns and gives the add/commit/push remedy for untracked files, naming the real root and bundle path", () => {
    const result = buildVisibilityWarnings({
      root,
      bundleRelativePath,
      files: [file("spec.md", "tracked"), file("issues/01-a.md", "untracked")],
      visibility: "tracked",
    });

    expect(result.hasUntracked).toBe(true);
    expect(result.hasIgnored).toBe(false);
    expect(result.warning).toMatch(/will not see/);
    expect(result.untrackedRemedy).toContain(`git -C ${root} add ${bundleRelativePath}`);
    expect(result.untrackedRemedy).toMatch(/git -C \/repo commit -m/);
    expect(result.untrackedRemedy).toContain(`git -C ${root} push`);
    expect(result.ignoredRemedy).toBeNull();
    expect(result.mismatchWarning).toBeNull();
  });

  it("warns and gives the check-ignore remedy per ignored file, naming the real root", () => {
    const result = buildVisibilityWarnings({
      root,
      bundleRelativePath,
      files: [file("issues/01-a.md", "ignored"), file("issues/02-b.md", "ignored")],
      visibility: "ignored",
    });

    expect(result.hasIgnored).toBe(true);
    expect(result.warning).toMatch(/will not see/);
    expect(result.ignoredRemedy).toMatch(/cannot be committed/i);
    expect(result.ignoredRemedy).toContain(`git -C ${root} check-ignore -v issues/01-a.md`);
    expect(result.ignoredRemedy).toContain(`git -C ${root} check-ignore -v issues/02-b.md`);
    expect(result.untrackedRemedy).toBeNull();
  });

  it("reports both remedies at once when a bundle has both untracked and ignored files", () => {
    const result = buildVisibilityWarnings({
      root,
      bundleRelativePath,
      files: [file("issues/01-a.md", "untracked"), file("issues/02-b.md", "ignored")],
      visibility: "tracked",
    });

    expect(result.untrackedRemedy).not.toBeNull();
    expect(result.ignoredRemedy).not.toBeNull();
  });

  it.each([
    ["tracked", "tracked" as const, [], false],
    ["tracked", "tracked" as const, ["ignored"], true],
    ["ignored", "ignored" as const, ["ignored"], false],
    ["ignored", "ignored" as const, ["tracked"], true],
    ["ignored", "ignored" as const, ["untracked"], true],
  ] as const)(
    "mismatch for flag %s with file visibilities %s -> %s",
    (_label, flag, visibilities, expectMismatch) => {
      const result = buildVisibilityWarnings({
        root,
        bundleRelativePath,
        files: visibilities.map((visibility, index) => file(`f${index}.md`, visibility)),
        visibility: flag,
      });

      if (expectMismatch) {
        expect(result.mismatchWarning).not.toBeNull();
        expect(result.mismatchWarning).toContain(flag);
      } else {
        expect(result.mismatchWarning).toBeNull();
      }
    },
  );

  it("names both the flag and the observed state in the mismatch warning", () => {
    const trackedFlagMismatch = buildVisibilityWarnings({
      root,
      bundleRelativePath,
      files: [file("spec.md", "ignored")],
      visibility: "tracked",
    });
    expect(trackedFlagMismatch.mismatchWarning).toContain("tracked");
    expect(trackedFlagMismatch.mismatchWarning).toMatch(/ignored/);

    const ignoredFlagMismatch = buildVisibilityWarnings({
      root,
      bundleRelativePath,
      files: [file("spec.md", "tracked")],
      visibility: "ignored",
    });
    expect(ignoredFlagMismatch.mismatchWarning).toContain("ignored");
  });
});

describe("buildVisibilityReport", () => {
  it("classifies real files and attaches the warnings in one call", async () => {
    const root = repos.create({ gitignore: ".scratch/\n" });
    const bundleDir = path.join(root, ".scratch", "05-feature");
    await fs.mkdir(bundleDir, { recursive: true });
    const specFile = path.join(bundleDir, "spec.md");
    await fs.writeFile(specFile, "# Spec");

    const report = await buildVisibilityReport({
      root,
      bundleDir,
      absolutePaths: [specFile],
      visibility: "tracked",
    });

    expect(report.files).toEqual([
      { path: specFile, relativePath: ".scratch/05-feature/spec.md", visibility: "ignored" },
    ]);
    expect(report.hasIgnored).toBe(true);
    expect(report.warning).not.toBeNull();
    expect(report.ignoredRemedy).toContain(
      `git -C ${root} check-ignore -v .scratch/05-feature/spec.md`,
    );
    // The project declares "tracked" but the directory is really ignored.
    expect(report.mismatchWarning).toContain("tracked");
  });
});
