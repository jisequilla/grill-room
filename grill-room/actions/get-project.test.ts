import { execFileSync } from "node:child_process";

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
