import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { repoPath } from "../test/repo-root.js";

const readJson = (...segments: string[]) =>
  JSON.parse(readFileSync(repoPath(...segments), "utf8")) as Record<
    string,
    unknown
  >;

const lintFixture = (source: string) => {
  const dir = mkdtempSync(join(tmpdir(), "lint-config-"));
  try {
    writeFileSync(join(dir, "fixture.ts"), source);
    writeFileSync(
      join(dir, "tsconfig.json"),
      JSON.stringify({
        compilerOptions: { strict: true, target: "ES2022", module: "ESNext" },
        include: ["fixture.ts"],
      }),
    );
    return spawnSync(
      "pnpm",
      [
        "exec",
        "oxlint",
        "--type-aware",
        "-c",
        repoPath("grill-room", ".oxlintrc.json"),
        dir,
      ],
      { cwd: repoPath("grill-room"), encoding: "utf8" },
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

describe("oxlint adoption", () => {
  it("oxlintrc is the one-rule config", () => {
    expect(readJson("grill-room", ".oxlintrc.json")).toEqual({
      categories: { correctness: "off" },
      rules: { "typescript/no-unnecessary-type-parameters": "error" },
      ignorePatterns: ["e2e/fixtures/**", ".agents/**"],
    });
  });

  it("package.json pins oxlint and runs it type-aware", () => {
    const pkg = readJson("grill-room", "package.json") as {
      scripts: Record<string, string>;
      devDependencies: Record<string, string>;
    };
    expect(pkg.scripts.lint).toBe("oxlint --type-aware");
    expect(pkg.devDependencies.oxlint).toBe("1.87.0");
    expect(pkg.devDependencies["oxlint-tsgolint"]).toBe("7.0.2004");
  });

  it(
    "the rule catches a discarded type parameter",
    () => {
      const discarded = lintFixture(
        "export function first<T>(x: T): number { return 1; }\n",
      );
      expect(discarded.status).not.toBe(0);
      expect(discarded.stdout + discarded.stderr).toContain(
        "no-unnecessary-type-parameters",
      );

      const linked = lintFixture(
        "export function same<T>(x: T): T { return x; }\n",
      );
      expect(linked.status).toBe(0);
    },
    30_000,
  );
});
