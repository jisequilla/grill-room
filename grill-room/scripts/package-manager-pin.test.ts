import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { repoPath } from "../test/repo-root.js";

const readJson = (...segments: string[]) =>
  JSON.parse(readFileSync(repoPath(...segments), "utf8")) as Record<
    string,
    unknown
  >;

describe("pnpm pin at the repository root", () => {
  it("root package.json pins pnpm", () => {
    expect(readJson("package.json")).toEqual({
      private: true,
      packageManager: "pnpm@10.29.1",
    });
  });

  it("root and app pins match", () => {
    expect(readJson("package.json").packageManager).toBe(
      readJson("grill-room", "package.json").packageManager,
    );
  });

  it("root node_modules is ignored", () => {
    const lines = readFileSync(repoPath(".gitignore"), "utf8").split("\n");
    expect(lines).toContain("/node_modules/");
  });

  it("root pnpm-lock.yaml is ignored", () => {
    const lines = readFileSync(repoPath(".gitignore"), "utf8").split("\n");
    expect(lines).toContain("/pnpm-lock.yaml");
  });
});
