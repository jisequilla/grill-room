import { execFileSync, spawn, spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { repoPath } from "../test/repo-root.js";

const SCRIPT = repoPath("scripts/revert-check.sh");

const folders: string[] = [];

afterEach(() => {
  for (const folder of folders.splice(0)) {
    rmSync(folder, { recursive: true, force: true });
  }
});

const tempFolder = (prefix: string): string => {
  const folder = mkdtempSync(join(tmpdir(), prefix));
  folders.push(folder);
  return folder;
};

const git = (cwd: string, ...args: string[]): void => {
  execFileSync("git", args, { cwd, stdio: "pipe" });
};

const write = (path: string, text: string): void => {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, text);
};

type Fixture = { origin: string; work: string };

const makeFixture = (options: { testOnly?: boolean } = {}): Fixture => {
  const root = tempFolder("revert-check-");
  const origin = join(root, "origin.git");
  const work = join(root, "work");
  git(root, "init", "-q", "--bare", origin);
  git(root, "init", "-q", work);
  git(work, "config", "user.email", "test@example.com");
  git(work, "config", "user.name", "Test");
  git(work, "remote", "add", "origin", origin);
  write(join(work, "src/a.ts"), "main\n");
  write(join(work, "src/a.test.ts"), "test-main\n");
  write(join(work, "grill-room/keep.txt"), "keep\n");
  git(work, "add", ".");
  git(work, "commit", "-q", "-m", "main");
  git(work, "branch", "-M", "main");
  git(work, "push", "-q", "-u", "origin", "main");
  git(work, "checkout", "-q", "-b", "feature");
  if (!options.testOnly) write(join(work, "src/a.ts"), "branch\n");
  write(join(work, "src/a.test.ts"), "test-branch\n");
  git(work, "commit", "-q", "-am", "branch");
  return { origin, work };
};

const run = (cwd: string, ...args: string[]) => {
  const result = spawnSync(SCRIPT, args, { cwd, encoding: "utf8" });
  return {
    stdout: result.stdout,
    stderr: result.stderr,
    status: result.status,
  };
};

const read = (work: string, file: string): string =>
  readFileSync(join(work, file), "utf8");

const status = (work: string): string =>
  execFileSync("git", ["status", "--porcelain"], {
    cwd: work,
    encoding: "utf8",
  });

const waitFor = async (check: () => boolean, ms: number): Promise<void> => {
  const deadline = Date.now() + ms;
  while (!check()) {
    if (Date.now() > deadline) throw new Error("timed out waiting");
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
};

const KILL_TEST =
  'touch started; bash -c "echo \\$\\$ > sleeppid; exec sleep 30"; echo done';

const alive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

const interrupt = async (signal: "SIGTERM" | "SIGINT") => {
  const { work } = makeFixture();
  const child = spawn(SCRIPT, [KILL_TEST], {
    cwd: work,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const exited = new Promise<number | null>((resolve) => {
    child.on("exit", (code) => resolve(code));
  });
  const pidFile = join(work, "sleeppid");
  try {
    await waitFor(
      () =>
        existsSync(join(work, "started")) &&
        existsSync(pidFile) &&
        readFileSync(pidFile, "utf8").trim() !== "",
      10_000,
    );
    const sleepPid = Number(readFileSync(pidFile, "utf8").trim());
    const sentAt = Date.now();
    child.kill(signal);
    const code = await exited;
    const elapsed = Date.now() - sentAt;
    const deadline = Date.now() + 2_000;
    while (alive(sleepPid) && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    return { code, elapsed, sleepAlive: alive(sleepPid), work };
  } finally {
    if (existsSync(pidFile)) {
      const pid = Number(readFileSync(pidFile, "utf8").trim());
      if (pid > 0 && alive(pid)) process.kill(pid, "SIGKILL");
    }
    if (child.exitCode === null && child.signalCode === null) {
      child.kill("SIGKILL");
    }
  }
};

describe("scripts/revert-check.sh", () => {
  it("row 1: a missing or empty argument prints the usage and runs no git", () => {
    for (const args of [[], [""]]) {
      const dir = tempFolder("revert-check-usage-");
      const log = join(dir, "calls.log");
      writeFileSync(log, "");
      const stub = join(dir, "git");
      writeFileSync(stub, `#!/bin/sh\necho "$@" >> "${log}"\n`);
      chmodSync(stub, 0o755);
      const result = spawnSync(SCRIPT, args, {
        cwd: dir,
        encoding: "utf8",
        env: { ...process.env, PATH: `${dir}:${process.env.PATH}` },
      });
      expect(result.stdout).toBe("");
      expect(result.stderr).toBe("usage: revert-check.sh '<test command>'\n");
      expect(result.status).toBe(2);
      expect(readFileSync(log, "utf8")).toBe("");
    }
  });

  it("row 2: a test-only PR prints the test-only line and runs nothing", () => {
    const { work } = makeFixture({ testOnly: true });
    const result = run(work, "touch ran");
    expect(result.stdout).toBe("test-only PR: no source to revert\n");
    expect(result.status).toBe(0);
    expect(existsSync(join(work, "ran"))).toBe(false);
  });

  it("row 3: a failed revert runs no test and leaves the file alone", () => {
    const { work } = makeFixture();
    write(join(work, "src/a.ts"), "dirty\n");
    const result = run(work, "touch ran");
    expect(result.stdout).toBe("git apply -R failed\n");
    expect(result.stderr).toContain("error:");
    expect(result.status).toBe(3);
    expect(existsSync(join(work, "ran"))).toBe(false);
    expect(read(work, "src/a.ts")).toBe("dirty\n");
  });

  it("row 4: the test's status is the exit and the source is re-applied", () => {
    const { work } = makeFixture();
    const result = run(work, "cat src/a.ts; exit 7");
    expect(result.stdout).toBe("main\n");
    expect(result.status).toBe(7);
    expect(read(work, "src/a.ts")).toBe("branch\n");
    expect(status(work)).toBe("");
  });

  it("row 5: a passing test sees the reverted source and the source comes back", () => {
    const { work } = makeFixture();
    const result = run(work, "cat src/a.ts");
    expect(result.stdout).toBe("main\n");
    expect(result.status).toBe(0);
    expect(read(work, "src/a.ts")).toBe("branch\n");
  });

  it("row 6: a failed re-apply prints git apply failed and exits 4", () => {
    const { work } = makeFixture();
    const result = run(work, "echo x >> src/a.ts");
    expect(result.stdout).toBe("git apply failed\n");
    expect(result.status).toBe(4);
  });

  it("row 6b: a failed re-apply wins over the test's status", () => {
    const { work } = makeFixture();
    const result = run(work, "echo x >> src/a.ts; exit 7");
    expect(result.stdout).toBe("git apply failed\n");
    expect(result.status).toBe(4);
  });

  it("row 7: it works from a subfolder of the worktree", () => {
    const { work } = makeFixture();
    const result = run(join(work, "grill-room"), "cat src/a.ts");
    expect(result.stdout).toBe("main\n");
    expect(result.status).toBe(0);
    expect(read(work, "src/a.ts")).toBe("branch\n");
  });

  it(
    "row 8: SIGTERM kills the test's whole process group and re-applies",
    async () => {
      const { code, elapsed, sleepAlive, work } = await interrupt("SIGTERM");
      expect(code).toBe(143);
      expect(elapsed).toBeLessThan(10_000);
      expect(read(work, "src/a.ts")).toBe("branch\n");
      expect(sleepAlive).toBe(false);
    },
    20_000,
  );

  it(
    "row 8b: SIGINT kills the test's whole process group and re-applies",
    async () => {
      const { code, elapsed, sleepAlive, work } = await interrupt("SIGINT");
      expect(code).toBe(130);
      expect(elapsed).toBeLessThan(10_000);
      expect(read(work, "src/a.ts")).toBe("branch\n");
      expect(sleepAlive).toBe(false);
    },
    20_000,
  );

  it("row 9: test files stay in place while the source is reverted", () => {
    const { work } = makeFixture();
    const result = run(work, "cat src/a.test.ts");
    expect(result.stdout).toBe("test-branch\n");
    expect(result.status).toBe(0);
  });

  it("row 10: a failed fetch prints git fetch failed and runs nothing", () => {
    const { work } = makeFixture();
    git(work, "remote", "set-url", "origin", join(work, "does-not-exist"));
    const result = run(work, "touch ran");
    expect(result.stdout).toBe("git fetch failed\n");
    expect(result.status).toBe(5);
    expect(existsSync(join(work, "ran"))).toBe(false);
  });

  it(
    "row 11: a TERM during the revert still re-applies the source",
    async () => {
      const { work } = makeFixture();
      const shims = tempFolder("revert-shim-");
      const realGit = execFileSync("which", ["git"], { encoding: "utf8" }).trim();
      const shim = join(shims, "git");
      writeFileSync(
        shim,
        `#!/usr/bin/env bash\nif [ "$1" = apply ] && [ "$2" = -R ]; then sleep 2; fi\nexec ${realGit} "$@"\n`,
      );
      chmodSync(shim, 0o755);
      const child = spawn(SCRIPT, ["touch ran"], {
        cwd: work,
        env: { ...process.env, PATH: `${shims}:${process.env.PATH}` },
        stdio: "ignore",
      });
      const exited = new Promise<number | null>((resolve) => {
        child.on("exit", (code) => resolve(code));
      });
      try {
        await new Promise((resolve) => setTimeout(resolve, 1_200));
        child.kill("SIGTERM");
        expect(await exited).toBe(143);
        expect(read(work, "src/a.ts")).toBe("branch\n");
        expect(status(work)).toBe("");
      } finally {
        if (child.exitCode === null && child.signalCode === null) {
          child.kill("SIGKILL");
        }
      }
    },
    20_000,
  );

  it("row 12: the temporary patch file is removed on exit", () => {
    const { work } = makeFixture();
    const tmp = tempFolder("revert-tmp-");
    const result = spawnSync(SCRIPT, ["true"], {
      cwd: work,
      encoding: "utf8",
      env: { ...process.env, TMPDIR: tmp },
    });
    expect(result.status).toBe(0);
    expect(readdirSync(tmp)).toEqual([]);
  });
});
