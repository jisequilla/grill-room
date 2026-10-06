import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";

import path from "node:path";

import { describe, expect, it } from "vitest";

import { useTestDatabase } from "../test/db.js";
import { useTempGitRepos } from "../test/git-repos.js";
import getProject from "./get-project.js";
import registerProject from "./register-project.js";

const repos = useTempGitRepos();

/** Add a bare remote to a temp repo, never a write `runGit` allows. */
function addRemote(root: string): void {
  execFileSync("git", ["-C", root, "remote", "add", "origin", "https://example.invalid/repo.git"], {
    stdio: "ignore",
  });
}

describe("get-project hasRemote", () => {
  useTestDatabase();

  it("is false without a remote and true once one is added", async () => {
    const root = repos.create();
    const project = await registerProject.run({
      root,
      verifyCommand: "pnpm test",
      workingExportFolder: ".scratch",
    });

    expect((await getProject.run({ id: project.id })).hasRemote).toBe(false);

    addRemote(root);

    expect((await getProject.run({ id: project.id })).hasRemote).toBe(true);
  });
});

describe("get-project folderVisibility", () => {
  useTestDatabase();

  async function register(root: string) {
    return registerProject.run({
      root,
      verifyCommand: "pnpm test",
      workingExportFolder: ".scratch",
    });
  }

  it("is tracked for both folders with no ignore rule", async () => {
    const project = await register(repos.create());

    expect((await getProject.run({ id: project.id })).folderVisibility).toEqual({
      durable: "tracked",
      working: "tracked",
    });
  });

  it("reports the durable folder as ignored once a .gitignore line for it is committed", async () => {
    const root = repos.create();
    const project = await register(root);
    await fs.writeFile(path.join(root, ".gitignore"), "docs/specs/\n");
    execFileSync("git", ["-C", root, "add", ".gitignore"], { stdio: "ignore" });

    expect((await getProject.run({ id: project.id })).folderVisibility).toEqual({
      durable: "ignored",
      working: "tracked",
    });
  });

  it("reports the working folder as ignored", async () => {
    const project = await register(repos.create({ gitignore: ".scratch/\n" }));

    expect((await getProject.run({ id: project.id })).folderVisibility).toEqual({
      durable: "tracked",
      working: "ignored",
    });
  });

  it("is null for a folder git cannot answer for: a root that is no longer a repository", async () => {
    const root = repos.create();
    const project = await register(root);
    await fs.rm(path.join(root, ".git"), { recursive: true, force: true });

    expect((await getProject.run({ id: project.id })).folderVisibility).toEqual({
      durable: null,
      working: null,
    });
  });
});
