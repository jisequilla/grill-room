import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it, vi } from "vitest";

const APP_DIRECTORY = path.resolve(
  fileURLToPath(new URL("..", import.meta.url)),
);

async function loadRepoRoot() {
  vi.resetModules();
  return import("./repo-root.js");
}

describe("the repository root the suite reads from", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("is the app's parent directory when no override is set", async () => {
    vi.stubEnv("GRILL_ROOM_REPO_ROOT", undefined);
    const { REPO_ROOT, repoPath } = await loadRepoRoot();
    expect(REPO_ROOT).toBe(path.dirname(APP_DIRECTORY));
    expect(existsSync(repoPath(".claude/skills/grilling/SKILL.md"))).toBe(true);
  });

  it("is the directory GRILL_ROOM_REPO_ROOT names, as a Stryker sandbox needs", async () => {
    vi.stubEnv("GRILL_ROOM_REPO_ROOT", "/elsewhere/repo");
    const { REPO_ROOT, repoPath } = await loadRepoRoot();
    expect(REPO_ROOT).toBe("/elsewhere/repo");
    expect(repoPath(".claude", "workflows")).toBe(
      "/elsewhere/repo/.claude/workflows",
    );
  });
});
