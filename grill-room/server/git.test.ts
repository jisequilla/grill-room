import { describe, expect, it } from "vitest";

import { useTempGitRepos } from "../test/git-repos.js";
import { runGit } from "./git.js";

const repos = useTempGitRepos();

describe("runGit's read-only guard", () => {
  it("allows the read-only subcommands", async () => {
    const root = repos.create();

    const revParse = await runGit(root, ["rev-parse", "HEAD"]);
    expect(revParse.exitCode).toBe(0);

    const log = await runGit(root, ["log", "-n", "10", "--format=%s"]);
    expect(log.exitCode).toBe(0);

    const status = await runGit(root, ["status", "--porcelain"]);
    expect(status.exitCode).toBe(0);

    const grep = await runGit(root, ["grep", "-l", "-w", "-F", "-e", "fixture"]);
    expect(grep.exitCode).toBe(0);
    expect(grep.stdout).toBe("README.md\n");
  });

  it("allows `remote -v` but nothing else under `remote`", async () => {
    const root = repos.create();

    const remoteV = await runGit(root, ["remote", "-v"]);
    expect(remoteV.exitCode).toBe(0);

    await expect(runGit(root, ["remote", "add", "origin", "https://example.com/repo.git"])).rejects.toThrow(
      /only "remote -v" is allowed/,
    );
    await expect(runGit(root, ["remote", "-v", "extra"])).rejects.toThrow(/only "remote -v" is allowed/);
    await expect(runGit(root, ["remote"])).rejects.toThrow(/only "remote -v" is allowed/);
    await expect(runGit(root, ["remote", "set-url", "origin", "https://example.com/repo.git"])).rejects.toThrow(
      /only "remote -v" is allowed/,
    );
  });

  it("refuses `log --output`, in either spelling, but allows an ordinary log call", async () => {
    const root = repos.create();

    await expect(runGit(root, ["log", "--output=/tmp/x"])).rejects.toThrow(/"--output" writes to a file/);
    await expect(runGit(root, ["log", "--output", "/tmp/x"])).rejects.toThrow(/"--output" writes to a file/);

    const log = await runGit(root, ["log", "-n", "10", "--format=%s"]);
    expect(log.exitCode).toBe(0);
  });

  it.each([
    ["-lO x", ["grep", "-lO", "x"]],
    ["-O x", ["grep", "-O", "x"]],
    ["--open-files-in-pager", ["grep", "--open-files-in-pager", "x"]],
    ["--open-files", ["grep", "--open-files", "x"]],
    ["--no-i", ["grep", "--no-i", "-e", "x"]],
    ["--no-index", ["grep", "--no-index", "-e", "x"]],
    ["an extra argument", ["grep", "-l", "-w", "-F", "-e", "x", "extra"]],
    ["no -l -w -F", ["grep", "-e", "x"]],
    ["a $ pattern", ["grep", "-l", "-w", "-F", "-e", "$x"]],
    ["a pattern with a space", ["grep", "-l", "-w", "-F", "-e", "a b"]],
  ])("refuses every other grep form: %s", async (_name, args) => {
    const root = repos.create();

    await expect(runGit(root, args)).rejects.toThrow(/grep -l -w -F -e <identifier>/);
  });

  it("refuses subcommands outside the read-only set", async () => {
    const root = repos.create();

    await expect(runGit(root, ["config", "user.name", "someone"])).rejects.toThrow(
      /only read-only subcommands are allowed/,
    );
    await expect(runGit(root, ["commit", "-m", "nope"])).rejects.toThrow(
      /only read-only subcommands are allowed/,
    );
  });
});
