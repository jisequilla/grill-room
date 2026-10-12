import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { describe, expect, it } from "vitest";

import { useTempGitRepos } from "../test/git-repos";
import { repoPath } from "../test/repo-root";
import {
  CAP,
  countMutantLines,
  inMutationScope,
  isEntryPoint,
  loadTestIndex,
  planStrykerRun,
  preferNotCoveredFor,
  rangesFromCoverage,
  rangesFromDiff,
  scopeFor,
  strykerArgs,
  summarize,
  trimToCap,
  uncoveredPreferred,
  type LineCount,
  type RunRecord,
  type StrykerReport,
  type TestIndex,
} from "./mutate-diff";

function diffOf(file: string, hunks: string[]): string {
  return [
    `diff --git a/${file} b/${file}`,
    "index 1111111..2222222 100644",
    `--- a/${file}`,
    `+++ b/${file}`,
    ...hunks,
  ].join("\n");
}

describe("rangesFromDiff", () => {
  const rows: Array<[string, string, string[]]> = [
    [
      "two hunks",
      diffOf("server/b.ts", ["@@ -3,0 +4,2 @@", "+a", "+b", "@@ -20 +22 @@", "-x", "+y"]),
      ["server/b.ts:4-5", "server/b.ts:22-22"],
    ],
    ["deletion only", diffOf("server/b.ts", ["@@ -9,3 +8,0 @@", "-a"]), []],
    ["test file", diffOf("server/b.test.ts", ["@@ -1,0 +2,4 @@"]), []],
    ["under e2e/", diffOf("e2e/flow.ts", ["@@ -1,0 +1,3 @@"]), []],
    ["under test/", diffOf("test/db.ts", ["@@ -1,0 +1,3 @@"]), []],
    ["tsx without a test", diffOf("app/x.tsx", ["@@ -5,0 +6,1 @@"]), []],
    ["mjs", diffOf("scripts/tool.mjs", ["@@ -1,0 +1,2 @@"]), ["scripts/tool.mjs:1-2"]],
    ["js", diffOf("shared/old.js", ["@@ -4,0 +5,1 @@"]), ["shared/old.js:5-5"]],
    ["markdown", diffOf("docs/notes.md", ["@@ -1,0 +1,2 @@"]), []],
    ["cjs", diffOf("server/c.cjs", ["@@ -2,0 +3,1 @@"]), ["server/c.cjs:3-3"]],
    ["jsx", diffOf("app/w.jsx", ["@@ -7,0 +8,2 @@"]), ["app/w.jsx:8-9"]],
    ["snapshot", diffOf("fixtures/out.snap", ["@@ -1,0 +1,2 @@"]), []],
    ["stryker config", diffOf("stryker.config.mjs", ["@@ -1,0 +1,9 @@"]), []],
    ["vitest config", diffOf("vitest.config.ts", ["@@ -3,0 +4,2 @@"]), []],
    ["agent-native config", diffOf("agent-native.config.ts", ["@@ -1,0 +1,1 @@"]), []],
    ["playwright config", diffOf("playwright.config.ts", ["@@ -1,0 +1,1 @@"]), []],
    ["react-router config", diffOf("react-router.config.ts", ["@@ -1,0 +1,1 @@"]), []],
    ["vite config", diffOf("vite.config.ts", ["@@ -1,0 +1,1 @@"]), []],
    [
      "a module named .config.ts in a folder",
      diffOf("server/foo.config.ts", ["@@ -1,0 +1,1 @@"]),
      ["server/foo.config.ts:1-1"],
    ],
    [
      "a config at the root that is not in the list",
      diffOf("new.config.ts", ["@@ -1,0 +1,1 @@"]),
      ["new.config.ts:1-1"],
    ],
    [
      "vite config in a folder",
      diffOf("app/vite.config.ts", ["@@ -1,0 +1,1 @@"]),
      ["app/vite.config.ts:1-1"],
    ],
    ["a name that only contains config", diffOf("server/config.ts", ["@@ -1,0 +1,1 @@"]), ["server/config.ts:1-1"]],
    ["config only midway through the name", diffOf("app/theme.config.json.ts", ["@@ -1,0 +1,1 @@"]), ["app/theme.config.json.ts:1-1"]],
    [
      "context text after the header",
      diffOf("server/d.ts", ["@@ -1,0 +2 @@ export function d() {"]),
      ["server/d.ts:2-2"],
    ],
    [
      "deleted file",
      [
        "diff --git a/server/gone.ts b/server/gone.ts",
        "deleted file mode 100644",
        "--- a/server/gone.ts",
        "+++ /dev/null",
        "@@ -1,3 +0,0 @@",
        "-a",
      ].join("\n"),
      [],
    ],
    [
      "mode change and binary file",
      [
        "diff --git a/server/run.ts b/server/run.ts",
        "old mode 100644",
        "new mode 100755",
        "diff --git a/app/logo.png b/app/logo.png",
        "Binary files a/app/logo.png and b/app/logo.png differ",
      ].join("\n"),
      [],
    ],
    [
      "rename shown as deletion plus addition",
      [
        "diff --git a/server/a.ts b/server/a.ts",
        "deleted file mode 100644",
        "--- a/server/a.ts",
        "+++ /dev/null",
        "@@ -1,3 +0,0 @@",
        "-a",
        diffOf("server/b.ts", ["@@ -0,0 +1,3 @@"]),
      ].join("\n"),
      ["server/b.ts:1-3"],
    ],
    [
      "diff order is kept",
      [
        diffOf("server/z.ts", ["@@ -1,0 +1,1 @@"]),
        diffOf("server/a.ts", ["@@ -1,0 +1,1 @@"]),
        diffOf("app/m.ts", ["@@ -1,0 +1,1 @@"]),
      ].join("\n"),
      ["server/z.ts:1-1", "server/a.ts:1-1", "app/m.ts:1-1"],
    ],
  ];

  it("rangesFromDiff: each table row", () => {
    expect(rows.map(([name, diff]) => [name, rangesFromDiff(diff, [])])).toEqual(
      rows.map(([name, , expected]) => [name, expected]),
    );
  });
});

describe("rangesFromCoverage", () => {
  const root = "/work/grill-room";
  const statement = (start: number, end = start) => ({
    start: { line: start },
    end: { line: end },
  });
  const coverageFor = (statements: Array<[number, number, number]>) => ({
    statementMap: Object.fromEntries(
      statements.map(([start, end], index) => [String(index), statement(start, end)]),
    ),
    s: Object.fromEntries(statements.map(([, , hits], index) => [String(index), hits])),
  });

  it("rangesFromCoverage: each table row", () => {
    const cases: Array<[string, Record<string, ReturnType<typeof coverageFor>>, string[]]> = [
      [
        "merges consecutive hit lines",
        {
          [`${root}/server/a.ts`]: coverageFor([
            [3, 3, 1],
            [4, 4, 1],
            [5, 5, 2],
            [6, 6, 0],
            [7, 7, 1],
          ]),
        },
        ["server/a.ts:3-5", "server/a.ts:7-7"],
      ],
      [
        "multi-line statement",
        { [`${root}/server/a.ts`]: coverageFor([[10, 12, 1]]) },
        ["server/a.ts:10-12"],
      ],
      [
        "one hit and one unhit statement on a line",
        {
          [`${root}/server/a.ts`]: coverageFor([
            [20, 20, 1],
            [20, 20, 0],
          ]),
        },
        ["server/a.ts:20-20"],
      ],
      ["test file", { [`${root}/server/a.test.ts`]: coverageFor([[1, 1, 1]]) }, []],
      ["under test/", { [`${root}/test/helper.ts`]: coverageFor([[1, 1, 1]]) }, []],
      [
        "outside root",
        { "/elsewhere/node_modules/x/index.js": coverageFor([[1, 1, 1]]) },
        [],
      ],
      [
        "tooling config out, a module named .config.ts in",
        {
          [`${root}/vitest.config.ts`]: coverageFor([[1, 1, 1]]),
          [`${root}/server/foo.config.ts`]: coverageFor([[1, 1, 1]]),
        },
        ["server/foo.config.ts:1-1"],
      ],
      [
        "key order kept",
        {
          [`${root}/server/q.ts`]: coverageFor([[4, 4, 1]]),
          [`${root}/app/c.ts`]: coverageFor([[2, 2, 1]]),
        },
        ["server/q.ts:4-4", "app/c.ts:2-2"],
      ],
    ];
    expect(cases.map(([name, coverage]) => [name, rangesFromCoverage(coverage, root, [])])).toEqual(
      cases.map(([name, , expected]) => [name, expected]),
    );
  });
});

describe("trimToCap", () => {
  it("trimToCap: each table row", () => {
    const cases: Array<[string, Array<[string, number, number]>, string[], string[]]> = [
      [
        "fits exactly",
        [["a.ts", 10, 3], ["a.ts", 11, 97], ["b.ts", 5, 1]],
        ["a.ts:10-11"],
        ["b.ts:5-5"],
      ],
      [
        "stops at the first line that does not fit",
        [["a.ts", 10, 60], ["a.ts", 11, 50], ["b.ts", 5, 10]],
        ["a.ts:10-10"],
        ["a.ts:11-11", "b.ts:5-5"],
      ],
      ["single oversized line", [["b.ts", 7, 120]], [], ["b.ts:7-7"]],
      [
        "no merge across a gap",
        [["a.ts", 10, 40], ["a.ts", 12, 30]],
        ["a.ts:10-10", "a.ts:12-12"],
        [],
      ],
      [
        "no merge across files",
        [["a.ts", 11, 5], ["b.ts", 12, 5]],
        ["a.ts:11-11", "b.ts:12-12"],
        [],
      ],
    ];
    const run = (lines: Array<[string, number, number]>) =>
      trimToCap(
        lines.map(([file, line, count]) => ({ file, line, count })),
        100,
      );
    expect(cases.map(([name, lines]) => [name, run(lines)])).toEqual(
      cases.map(([name, , kept, dropped]) => [name, { kept, dropped }]),
    );
  });
});

describe("countMutantLines", () => {
  it("countMutantLines: zero-count lines stay in the list so one range survives", async () => {
    const cwd = mkdtempSync(path.join(tmpdir(), "mutate-count-"));
    try {
      writeFileSync(
        path.join(cwd, "f.ts"),
        [
          "export function f(a: number) {",
          "  if (a > 1) {",
          "    return a + 1;",
          "  }",
          "",
          "  return a - 1;",
          "}",
          "",
        ].join("\n"),
      );
      const counted = await countMutantLines(["f.ts:1-7"], cwd);
      expect(counted).toEqual([
        { file: "f.ts", line: 1, count: 1 },
        { file: "f.ts", line: 2, count: 5 },
        { file: "f.ts", line: 3, count: 1 },
        { file: "f.ts", line: 4, count: 0 },
        { file: "f.ts", line: 5, count: 0 },
        { file: "f.ts", line: 6, count: 1 },
        { file: "f.ts", line: 7, count: 0 },
      ]);
      expect(trimToCap(counted, 100)).toEqual({ kept: ["f.ts:1-7"], dropped: [] });
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});

describe("planStrykerRun", () => {
  it("planStrykerRun: kept lines without a mutant do not start Stryker", async () => {
    const cwd = mkdtempSync(path.join(tmpdir(), "mutate-plan-"));
    try {
      const heavy = `export const total = ${Array.from({ length: 104 }, () => "a").join(" + ")};`;
      writeFileSync(path.join(cwd, "f.ts"), `// comment\n${heavy}\n`);
      const counted = await countMutantLines(["f.ts:1-2"], cwd);
      expect(counted[0]).toEqual({ file: "f.ts", line: 1, count: 0 });
      expect(counted[1].count).toBeGreaterThan(100);

      const plan = planStrykerRun(counted, 100);
      expect(plan).toEqual({ kept: ["f.ts:1-1"], dropped: ["f.ts:2-2"], startable: false });
      expect(
        summarize(null, {
          outcome: "nothing-kept",
          base: null,
          scope: ["f.ts:1-2"],
          dropped: plan.dropped,
          command: null,
          elapsedMs: null,
          exitCode: null,
          stderrTail: null,
          preferNotCovered: [],
        }),
      ).toEqual({
        status: "truncated",
        base: null,
        scope: ["f.ts:1-2"],
        dropped: ["f.ts:2-2"],
        command: null,
        elapsedMs: null,
        mutants: 0,
        score: null,
        survivors: [],
        exitCode: null,
        stderrTail: null,
        preferNotCovered: [],
      });
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("planStrykerRun: a kept line with mutants is startable", () => {
    expect(
      planStrykerRun(
        [
          { file: "a.ts", line: 1, count: 0 },
          { file: "a.ts", line: 2, count: 3 },
        ],
        100,
      ),
    ).toEqual({ kept: ["a.ts:1-2"], dropped: [], startable: true });
  });
});

describe("summarize", () => {
  const mutant = (line: number, status: string) => ({
    mutatorName: "ConditionalExpression",
    status,
    location: { start: { line, column: 1 }, end: { line, column: 5 } },
  });
  const report: StrykerReport = {
    files: {
      "server/a.ts": {
        mutants: [
          mutant(3, "Killed"),
          mutant(7, "Survived"),
          mutant(9, "NoCoverage"),
          mutant(11, "Timeout"),
          mutant(13, "Ignored"),
        ],
      },
    },
  };
  const run: RunRecord = {
    outcome: "finished",
    base: "origin/main",
    scope: ["server/a.ts:1-20"],
    dropped: [],
    command: "pnpm exec stryker run --mutate server/a.ts:1-20",
    elapsedMs: 4200,
    exitCode: 0,
    stderrTail: null,
    preferNotCovered: [],
  };

  it("summarize: survivors, mutants and score", () => {
    const summary = summarize(report, run);
    expect({
      mutants: summary.mutants,
      score: summary.score,
      survivors: summary.survivors,
    }).toEqual({
      mutants: 4,
      score: 50,
      survivors: [
        { file: "server/a.ts", line: 7, mutator: "ConditionalExpression", status: "Survived" },
        { file: "server/a.ts", line: 9, mutator: "ConditionalExpression", status: "NoCoverage" },
      ],
    });
  });

  it("summarize: every status's full shape", () => {
    const survivors = [
      { file: "server/a.ts", line: 7, mutator: "ConditionalExpression", status: "Survived" },
      { file: "server/a.ts", line: 9, mutator: "ConditionalExpression", status: "NoCoverage" },
    ];
    const finished = {
      base: "origin/main",
      scope: run.scope,
      command: run.command,
      elapsedMs: 4200,
      mutants: 4,
      score: 50,
      survivors,
      exitCode: 0,
      stderrTail: null,
    };

    expect(summarize(report, run)).toEqual({
      status: "ok",
      dropped: [],
      preferNotCovered: [],
      ...finished,
    });
    expect(
      summarize(report, {
        ...run,
        dropped: ["server/a.ts:30-31"],
        preferNotCovered: ["y.ts:1-5"],
      }),
    ).toEqual({
      status: "truncated",
      dropped: ["server/a.ts:30-31"],
      preferNotCovered: ["y.ts:1-5"],
      ...finished,
    });
    expect(
      summarize(null, {
        ...run,
        outcome: "nothing-kept",
        dropped: ["server/a.ts:7-7"],
        command: null,
        elapsedMs: null,
        exitCode: null,
      }),
    ).toEqual({
      status: "truncated",
      base: "origin/main",
      scope: run.scope,
      dropped: ["server/a.ts:7-7"],
      command: null,
      elapsedMs: null,
      mutants: 0,
      score: null,
      survivors: [],
      exitCode: null,
      stderrTail: null,
      preferNotCovered: [],
    });
    expect(
      summarize(null, {
        ...run,
        outcome: "overrun",
        dropped: ["x.ts:1-1"],
        exitCode: null,
        stderrTail: "partial output",
      }),
    ).toEqual({
      status: "overrun",
      base: "origin/main",
      scope: run.scope,
      dropped: ["x.ts:1-1"],
      command: run.command,
      elapsedMs: 4200,
      mutants: null,
      score: null,
      survivors: null,
      exitCode: null,
      stderrTail: null,
      preferNotCovered: [],
    });
    expect(
      summarize(null, {
        ...run,
        outcome: "runner-failed",
        exitCode: 1,
        stderrTail: "boom",
        preferNotCovered: null,
      }),
    ).toEqual({
      status: "runner-failed",
      base: "origin/main",
      scope: run.scope,
      dropped: [],
      command: run.command,
      elapsedMs: 4200,
      mutants: null,
      score: null,
      survivors: null,
      exitCode: 1,
      stderrTail: "boom",
      preferNotCovered: null,
    });
    expect(
      summarize(null, {
        outcome: "no-scope",
        base: null,
        scope: [],
        dropped: [],
        command: null,
        elapsedMs: null,
        exitCode: null,
        stderrTail: null,
        preferNotCovered: [],
      }),
    ).toEqual({
      status: "no-scope",
      base: null,
      scope: [],
      dropped: [],
      command: null,
      elapsedMs: null,
      mutants: 0,
      score: null,
      survivors: [],
      exitCode: null,
      stderrTail: null,
      preferNotCovered: [],
    });
  });
});

describe("scopeFor", () => {
  const repos = useTempGitRepos();

  function git(root: string, args: string[]): string {
    const env: NodeJS.ProcessEnv = { ...process.env };
    for (const name of ["GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE"]) delete env[name];
    return execFileSync(
      "git",
      [
        "-C",
        root,
        "-c",
        "user.name=Grill Room Tests",
        "-c",
        "user.email=tests@example.invalid",
        "-c",
        "commit.gpgsign=false",
        "-c",
        "core.hooksPath=/dev/null",
        ...args,
      ],
      { env, encoding: "utf8" },
    ).trim();
  }

  function commitChange(
    root: string,
    change: { write?: Record<string, string>; remove?: string[]; rename?: [string, string] },
  ): string {
    const base = git(root, ["rev-parse", "HEAD"]);
    for (const [file, contents] of Object.entries(change.write ?? {})) {
      mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
      writeFileSync(path.join(root, file), contents);
    }
    for (const file of change.remove ?? []) rmSync(path.join(root, file));
    if (change.rename) git(root, ["mv", change.rename[0], change.rename[1]]);
    git(root, ["add", "-A"]);
    git(root, ["commit", "-q", "-m", "change"]);
    return base;
  }

  it("scopeFor: source diff", () => {
    const root = repos.create({
      files: { "server/a.ts": "export const a = 1;\n", "server/a.test.ts": "// t\n" },
    });
    const base = commitChange(root, {
      write: {
        "server/a.ts": "export const a = 1;\nexport const b = 2;\nexport const c = 3;\n",
        "server/a.test.ts": "// t\n// more\n",
      },
    });
    expect(scopeFor(base, root, [])).toEqual({
      kind: "ranges",
      ranges: ["server/a.ts:2-3"],
      testFiles: ["server/a.test.ts"],
    });
  });

  it("scopeFor: an app in a subfolder yields paths relative to it and skips files outside it", () => {
    const repo = repos.create({
      files: {
        "grill-room/server/a.ts": "export const a = 1;\n",
        "other/b.ts": "export const b = 1;\n",
      },
    });
    const app = path.join(repo, "grill-room");
    const base = commitChange(repo, {
      write: {
        "grill-room/server/a.ts": "export const a = 1;\nexport const c = 3;\n",
        "other/b.ts": "export const b = 1;\nexport const d = 4;\n",
      },
    });
    expect(scopeFor(base, app, [])).toEqual({
      kind: "ranges",
      ranges: ["server/a.ts:2-2"],
      testFiles: [],
    });
  });

  it("scopeFor: each test-only row", () => {
    const rows: Array<{
      name: string;
      files: Record<string, string>;
      change: Parameters<typeof commitChange>[1];
      expected: ReturnType<typeof scopeFor>;
    }> = [
      {
        name: "modifies a test",
        files: { "x.test.ts": "// 1\n" },
        change: { write: { "x.test.ts": "// 1\n// 2\n" } },
        expected: { kind: "coverage", testFiles: ["x.test.ts"] },
      },
      {
        name: "deletes one test, adds another",
        files: { "old.test.ts": "// old\n" },
        change: { remove: ["old.test.ts"], write: { "y.test.ts": "// y\n" } },
        expected: { kind: "coverage", testFiles: ["y.test.ts"] },
      },
      {
        name: "renames a test unchanged",
        files: { "a.test.ts": "// a\n// b\n// c\n// d\n" },
        change: { rename: ["a.test.ts", "b.test.ts"] },
        expected: { kind: "coverage", testFiles: ["b.test.ts"] },
      },
      {
        name: "deletes a test only",
        files: { "old.test.ts": "// old\n" },
        change: { remove: ["old.test.ts"] },
        expected: { kind: "none" },
      },
      {
        name: "modifies an e2e spec only",
        files: { "e2e/y.spec.ts": "// 1\n" },
        change: { write: { "e2e/y.spec.ts": "// 1\n// 2\n" } },
        expected: { kind: "none" },
      },
      {
        name: "modifies a test helper only",
        files: { "test/git-repos.ts": "// 1\n" },
        change: { write: { "test/git-repos.ts": "// 1\n// 2\n" } },
        expected: { kind: "none" },
      },
      {
        name: "modifies a markdown file only",
        files: { "docs/notes.md": "one\n" },
        change: { write: { "docs/notes.md": "one\ntwo\n" } },
        expected: { kind: "none" },
      },
    ];
    const actual = rows.map((row) => {
      const root = repos.create({ files: row.files });
      const base = commitChange(root, row.change);
      return [row.name, scopeFor(base, root, [])];
    });
    expect(actual).toEqual(rows.map((row) => [row.name, row.expected]));
  });

  it("scopeFor: each scope row", () => {
    const mutable = (name: string) => `export const ${name} = 1 + 2;\n`;
    const rows: Array<{
      name: string;
      files: Record<string, string>;
      change: Record<string, string>;
      expected: ReturnType<typeof scopeFor>;
    }> = [
      {
        name: "S1",
        files: { "server/a.ts": "export const a = 1;\n", "server/a.test.ts": "// t\n" },
        change: { "server/a.ts": mutable("a"), "server/a.test.ts": "// t\n// more\n" },
        expected: { kind: "ranges", ranges: ["server/a.ts:1-1"], testFiles: ["server/a.test.ts"] },
      },
      {
        name: "S2",
        files: { "server/a.ts": "export const a = 1;\n", "server/x.test.ts": "// t\n" },
        change: { "server/a.ts": mutable("a"), "server/x.test.ts": "// t\n// more\n" },
        expected: { kind: "ranges", ranges: ["server/a.ts:1-1"], testFiles: [] },
      },
      {
        name: "S3",
        files: {
          "server/a.ts": "export const a = 1;\n",
          "server/b.ts": "export const b = 1;\n",
          "server/a.test.ts": "// t\n",
        },
        change: {
          "server/a.ts": mutable("a"),
          "server/b.ts": mutable("b"),
          "server/a.test.ts": "// t\n// more\n",
        },
        expected: {
          kind: "ranges",
          ranges: ["server/a.ts:1-1", "server/b.ts:1-1"],
          testFiles: [],
        },
      },
      {
        name: "S4",
        files: {
          "server/a.ts": "export const a = 1;\n",
          "server/a.test.ts": "// t\n",
          "e2e/x.spec.ts": "// t\n",
        },
        change: {
          "server/a.ts": mutable("a"),
          "server/a.test.ts": "// t\n// more\n",
          "e2e/x.spec.ts": "// t\n// more\n",
        },
        expected: { kind: "ranges", ranges: ["server/a.ts:1-1"], testFiles: ["server/a.test.ts"] },
      },
      {
        name: "S5",
        files: { "app/i18n/en-US.ts": "export const t = 1;\n", "server/a.test.ts": "// t\n" },
        change: { "app/i18n/en-US.ts": mutable("t"), "server/a.test.ts": "// t\n// more\n" },
        expected: { kind: "none" },
      },
      {
        name: "S6",
        files: { "server/a.test.ts": "// t\n" },
        change: { "server/a.test.ts": "// t\n// more\n" },
        expected: { kind: "coverage", testFiles: ["server/a.test.ts"] },
      },
      {
        name: "S7",
        files: { "server/a.ts": "export const a = 1;\n" },
        change: { "server/a.ts": mutable("a") },
        expected: { kind: "ranges", ranges: ["server/a.ts:1-1"], testFiles: [] },
      },
      {
        name: "S8",
        files: {
          "server/a.ts": "export const a = 1;\n",
          "app/i18n/en-US.ts": "export const t = 1;\n",
          "server/a.test.ts": "// t\n",
        },
        change: {
          "server/a.ts": mutable("a"),
          "app/i18n/en-US.ts": mutable("t"),
          "server/a.test.ts": "// t\n// more\n",
        },
        expected: { kind: "ranges", ranges: ["server/a.ts:1-1"], testFiles: ["server/a.test.ts"] },
      },
      {
        name: "S9",
        files: { "server/a.ts": "export const a = 1;\n", "other/a.test.ts": "// t\n" },
        change: { "server/a.ts": mutable("a"), "other/a.test.ts": "// t\n// more\n" },
        expected: { kind: "ranges", ranges: ["server/a.ts:1-1"], testFiles: [] },
      },
      {
        name: "S10",
        files: { "server/a.ts": "export const a = 1;\n", "server/a.spec.ts": "// t\n" },
        change: { "server/a.ts": mutable("a"), "server/a.spec.ts": "// t\n// more\n" },
        expected: { kind: "ranges", ranges: ["server/a.ts:1-1"], testFiles: ["server/a.spec.ts"] },
      },
      {
        name: "S11",
        files: { "server/foo.bar.ts": "export const a = 1;\n", "server/foo.bar.test.ts": "// t\n" },
        change: { "server/foo.bar.ts": mutable("a"), "server/foo.bar.test.ts": "// t\n// more\n" },
        expected: {
          kind: "ranges",
          ranges: ["server/foo.bar.ts:1-1"],
          testFiles: ["server/foo.bar.test.ts"],
        },
      },
    ];
    const actual = rows.map((row) => {
      const root = repos.create({ files: row.files });
      const base = commitChange(root, { write: row.change });
      return [row.name, scopeFor(base, root, [])];
    });
    expect(actual).toEqual(rows.map((row) => [row.name, row.expected]));
  });

  it("main: wires testFiles into the Stryker command", () => {
    const stubs = mkdtempSync(path.join(tmpdir(), "mutate-stub-"));
    try {
      const log = path.join(stubs, "argv.log");
      const stub = path.join(stubs, "pnpm");
      writeFileSync(
        stub,
        '#!/bin/sh\nif [ "$1" = exec ] && [ "$2" = stryker ]; then printf \'%s\\n\' "$*" >> "$STUB_LOG"; exit 1; fi\nexit 0\n',
        { mode: 0o755 },
      );
      const env = { PATH: `${stubs}:${process.env.PATH}`, STUB_LOG: log };
      const root = repos.create({
        files: { "server/a.ts": "export const a = 1;\n", "server/a.test.ts": "// t\n" },
      });
      const base = commitChange(root, {
        write: { "server/a.ts": "export const a = 1 + 2;\n", "server/a.test.ts": "// t\n// more\n" },
      });

      const onDiff = runStubbedCli(["--base", base], root, env);
      const onDiffLog = readFileSync(log, "utf8").trim().split("\n");
      rmSync(log);
      const mutated = runStubbedCli(["--mutate", "server/a.ts:1-1"], root, env);
      const mutatedLog = readFileSync(log, "utf8").trim().split("\n");

      expect({
        diffArgv: onDiffLog,
        diffCommand: JSON.parse(onDiff.stdout).command,
        mutateArgv: mutatedLog,
        mutateCommand: JSON.parse(mutated.stdout).command,
      }).toEqual({
        diffArgv: ["exec stryker run --mutate server/a.ts:1-1 --testFiles server/a.test.ts"],
        diffCommand: "pnpm exec stryker run --mutate server/a.ts:1-1 --testFiles server/a.test.ts",
        mutateArgv: ["exec stryker run --mutate server/a.ts:1-1"],
        mutateCommand: "pnpm exec stryker run --mutate server/a.ts:1-1",
      });
    } finally {
      rmSync(stubs, { recursive: true, force: true });
    }
  });
});

function runStubbedCli(args: string[], cwd: string, envOverride: NodeJS.ProcessEnv) {
  const script = fileURLToPath(new URL("./mutate-diff.ts", import.meta.url));
  const env: NodeJS.ProcessEnv = { ...process.env, ...envOverride };
  for (const name of ["GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE"]) delete env[name];
  return spawnSync(path.resolve("node_modules/.bin/tsx"), [script, ...args], {
    cwd,
    encoding: "utf8",
    env,
  });
}

describe("inMutationScope", () => {
  const foo = "app/components/x/foo.tsx";
  const entry = (testPath: string, text = "// nothing"): TestIndex => [{ path: testPath, text }];

  it("inMutationScope: each table row", () => {
    const rows: Array<[string, string, TestIndex, boolean]> = [
      ["1", "app/i18n/en-US.ts", [], false],
      ["2 server", "server/a.ts", [], true],
      ["2 route", "app/routes/bar.ts", [], true],
      ["3", foo, entry("app/components/x/foo.test.tsx"), true],
      ["4", foo, entry("app/components/x/foo.test.ts"), true],
      ["5", foo, entry("app/components/x/foo.spec.tsx"), true],
      ["6", foo, entry("app/a.test.tsx", 'import { Foo } from "./components/x/foo";'), true],
      ["7", foo, entry("server/b.test.ts", 'vi.mock("@/components/x/foo.js")'), true],
      ["11", foo, entry("app/a.test.tsx", "from './x/foo'"), true],
      ["12", foo, entry("app/a.test.tsx", '"./foo/index"'), true],
      ["13", "app/components/x/a+b.tsx", entry("app/a.test.tsx", '"./aab"'), false],
      ["14", "app/components/x/a+b.tsx", entry("app/a.test.tsx", '"./x/a+b"'), true],
      ["9", foo, entry("app/components/y/foo.test.tsx"), false],
      ["10", foo, [], false],
    ];
    expect(rows.map(([name, file, index]) => [name, inMutationScope(file, index)])).toEqual(
      rows.map(([name, , , expected]) => [name, expected]),
    );
  });

  it("inMutationScope: the i18n rule wins over a sibling test (1b)", () => {
    expect(inMutationScope("app/i18n/picker.tsx", entry("app/i18n/picker.test.tsx"))).toBe(false);
  });

  it("inMutationScope: a text that only contains the name is not a reference (8a-8c)", () => {
    const texts = ["const foobar = 1;", "barfoo.x", "obj.foo.y"];
    expect(texts.map((text) => inMutationScope(foo, entry("app/a.test.tsx", text)))).toEqual([
      false,
      false,
      false,
    ]);
  });

  it("inMutationScope: a sibling matches the whole base name, not a prefix (10b)", () => {
    expect(inMutationScope(foo, entry("app/components/x/foo-bar.test.tsx"))).toBe(false);
  });

  it("rangesFromDiff: drops out-of-scope files", () => {
    const diff = [
      diffOf("app/i18n/en-US.ts", ["@@ -1,0 +1,2 @@"]),
      diffOf("app/components/x/bare.tsx", ["@@ -1,0 +1,2 @@"]),
      diffOf("server/a.ts", ["@@ -1,0 +1,2 @@"]),
    ].join("\n");
    expect(rangesFromDiff(diff, [])).toEqual(["server/a.ts:1-2"]);
  });

  it("rangesFromCoverage: drops out-of-scope files", () => {
    const hit = { statementMap: { "0": { start: { line: 1 }, end: { line: 1 } } }, s: { "0": 1 } };
    const root = "/work/grill-room";
    const coverage = {
      [`${root}/app/i18n/en-US.ts`]: hit,
      [`${root}/app/components/x/bare.tsx`]: hit,
      [`${root}/server/a.ts`]: hit,
    };
    expect(rangesFromCoverage(coverage, root, [])).toEqual(["server/a.ts:1-1"]);
  });
});

describe("loadTestIndex", () => {
  const repos = useTempGitRepos();

  it("loadTestIndex: each table row", () => {
    const paths = (index: TestIndex) => index.map((entry) => entry.path).sort();

    const l1 = repos.create({
      files: { "a.test.ts": "// a\n", "b.spec.tsx": "// b\n", "src/c.ts": "// c\n" },
    });
    const l2 = repos.create({ files: { "e2e/x.test.ts": "// x\n" } });
    writeFileSync(path.join(l2, "d.test.ts"), "// d\n");
    const l3 = repos.create({ files: { "f.test.ts": "// f\n" } });
    rmSync(path.join(l3, "f.test.ts"));
    const l4 = repos.create({ files: { "grill-room/a.test.ts": "// a\n" } });
    const other = repos.create({ files: { "z.test.ts": "// z\n" } });

    const previous = process.env.GIT_DIR;
    process.env.GIT_DIR = path.join(other, ".git");
    let l5: TestIndex;
    try {
      l5 = loadTestIndex(l1);
    } finally {
      if (previous === undefined) delete process.env.GIT_DIR;
      else process.env.GIT_DIR = previous;
    }

    expect({
      L1: paths(loadTestIndex(l1)),
      L2: paths(loadTestIndex(l2)),
      L3: paths(loadTestIndex(l3)),
      L4: paths(loadTestIndex(path.join(l4, "grill-room"))),
      L5: paths(l5),
      text: loadTestIndex(l1).find((entry) => entry.path === "a.test.ts")?.text,
    }).toEqual({
      L1: ["a.test.ts", "b.spec.tsx"],
      L2: [],
      L3: [],
      L4: ["a.test.ts"],
      L5: ["a.test.ts", "b.spec.tsx"],
      text: "// a\n",
    });
  });
});

describe("mutation gate settings", () => {
  it("stryker config ignores static mutants", async () => {
    const specifier = pathToFileURL(repoPath("grill-room/stryker.config.mjs")).href;
    const config = (await import(specifier)) as { default: { ignoreStatic?: boolean } };
    expect(config.default.ignoreStatic).toBe(true);
  });

  it("CAP is 500", () => {
    expect(CAP).toBe(500);
  });

  it("strykerArgs: with and without test files", () => {
    expect({
      without: strykerArgs(["a.ts:1-2", "b.ts:3-4"], []),
      with: strykerArgs(["a.ts:1-2"], ["a.test.ts", "b.test.ts"]),
    }).toEqual({
      without: ["pnpm", "exec", "stryker", "run", "--mutate", "a.ts:1-2,b.ts:3-4"],
      with: [
        "pnpm",
        "exec",
        "stryker",
        "run",
        "--mutate",
        "a.ts:1-2",
        "--testFiles",
        "a.test.ts,b.test.ts",
      ],
    });
  });
});

describe("isEntryPoint", () => {
  it("isEntryPoint: both rows", () => {
    const own = fileURLToPath(new URL("./mutate-diff.ts", import.meta.url));
    const vitest = path.resolve("node_modules/vitest/vitest.mjs");
    const moduleUrl = new URL("./mutate-diff.ts", import.meta.url).href;
    expect([isEntryPoint(moduleUrl, own), isEntryPoint(moduleUrl, vitest)]).toEqual([true, false]);
  });
});

const lineList = (rows: string[]): LineCount[] =>
  rows.map((row) => {
    const [place, count] = row.split("x");
    const [file, line] = place.split(":");
    return { file, line: Number(line), count: Number(count) };
  });

describe("preferred ranges", () => {
  it("planStrykerRun: prefer ranks ahead of the cap", () => {
    const cases: Array<[string, string[], string[], object]> = [
      [
        "no prefer",
        ["a.ts:1x60", "a.ts:2x40", "z.ts:10x5"],
        [],
        { kept: ["a.ts:1-2"], dropped: ["z.ts:10-10"], startable: true },
      ],
      [
        "target after an unrelated file",
        ["a.ts:1x60", "a.ts:2x40", "z.ts:10x5"],
        ["z.ts:10-10"],
        { kept: ["a.ts:1-1", "z.ts:10-10"], dropped: ["a.ts:2-2"], startable: true },
      ],
      [
        "target deeper in the same file",
        ["b.ts:201x60", "b.ts:202x40", "b.ts:601x5", "b.ts:602x5"],
        ["b.ts:601-602"],
        { kept: ["b.ts:201-201", "b.ts:601-602"], dropped: ["b.ts:202-202"], startable: true },
      ],
      [
        "same lines without prefer",
        ["b.ts:201x60", "b.ts:202x40", "b.ts:601x5", "b.ts:602x5"],
        [],
        { kept: ["b.ts:201-202"], dropped: ["b.ts:601-602"], startable: true },
      ],
      [
        "list order differs from scope order",
        ["a.ts:1x50", "c.ts:1x50", "m.ts:1x30"],
        ["m.ts:1-1", "a.ts:1-1", "c.ts:1-1"],
        { kept: ["a.ts:1-1", "c.ts:1-1"], dropped: ["m.ts:1-1"], startable: true },
      ],
      [
        "partly covered range",
        ["a.ts:1x60", "z.ts:10x30", "z.ts:11x30", "z.ts:12x30"],
        ["z.ts:8-11"],
        { kept: ["z.ts:10-11"], dropped: ["a.ts:1-1", "z.ts:12-12"], startable: true },
      ],
      [
        "preferred ranges with no scope line",
        ["a.ts:1x60", "a.ts:2x40", "z.ts:10x5"],
        ["y.ts:1-5", "z.ts:50-60"],
        { kept: ["a.ts:1-2"], dropped: ["z.ts:10-10"], startable: true },
      ],
      [
        "two preferred ranges, only the second holds a scope line",
        ["a.ts:1x60", "a.ts:2x40", "z.ts:10x5"],
        ["y.ts:1-5", "z.ts:10-10"],
        { kept: ["a.ts:1-1", "z.ts:10-10"], dropped: ["a.ts:2-2"], startable: true },
      ],
      [
        "preferred lines are not counted twice against the cap",
        ["a.ts:1x20", "z.ts:10x60", "z.ts:11x20"],
        ["z.ts:10-10"],
        { kept: ["a.ts:1-1", "z.ts:10-11"], dropped: [], startable: true },
      ],
      [
        "preferred line that does not fit",
        ["f.ts:1x0", "f.ts:2x105"],
        ["f.ts:2-2"],
        { kept: [], dropped: ["f.ts:1-2"], startable: false },
      ],
    ];
    expect(cases.map(([name, rows, prefer]) => [name, planStrykerRun(lineList(rows), 100, prefer)])).toEqual(
      cases.map(([name, , , expected]) => [name, expected]),
    );
  });

  it("uncoveredPreferred: each table row", () => {
    const cases: Array<[string, string[], string[], string[]]> = [
      [
        "partly, fully and not covered",
        ["z.ts:10x5", "z.ts:11x5"],
        ["z.ts:8-11", "y.ts:1-5", "z.ts:50-60", "z.ts:11-11"],
        ["y.ts:1-5", "z.ts:50-60"],
      ],
      ["a zero-mutant line is still a scope line", ["f.ts:1x0"], ["f.ts:1-1"], []],
      ["empty scope", [], ["g.ts:5-9"], ["g.ts:5-9"]],
      ["nothing preferred", ["z.ts:10x5"], [], []],
    ];
    expect(cases.map(([name, rows, prefer]) => [name, uncoveredPreferred(lineList(rows), prefer)])).toEqual(
      cases.map(([name, , , expected]) => [name, expected]),
    );
  });

  it("preferNotCoveredFor: each table row", () => {
    const cases: Array<[string, string[] | null, string[], string[] | null]> = [
      ["unknown scope with prefer", null, ["y.ts:1-5"], null],
      ["unknown scope without prefer", null, [], null],
      ["no prefer", ["z.ts:10x5"], [], []],
      ["one of two not covered", ["z.ts:10x5"], ["z.ts:10-10", "y.ts:1-5"], ["y.ts:1-5"]],
      ["empty scope", [], ["g.ts:5-9"], ["g.ts:5-9"]],
    ];
    expect(
      cases.map(([name, rows, prefer]) => [
        name,
        preferNotCoveredFor(rows === null ? null : lineList(rows), prefer),
      ]),
    ).toEqual(cases.map(([name, , , expected]) => [name, expected]));
  });

  it("planStrykerRun: a preferred range deeper than the cap reaches survives it", async () => {
    const cwd = mkdtempSync(path.join(tmpdir(), "mutate-prefer-"));
    try {
      const sum = (name: string) =>
        `export const ${name} = ${Array.from({ length: 70 }, () => "a").join(" + ")};`;
      writeFileSync(path.join(cwd, "a.ts"), `${sum("first")}\n${sum("second")}\n`);
      writeFileSync(
        path.join(cwd, "z.ts"),
        "export function small(a: number) {\n  return a > 1;\n}\n",
      );
      const span = (start: number, end: number) => ({ start: { line: start }, end: { line: end } });
      const coverage: Parameters<typeof rangesFromCoverage>[0] = {
        [path.join(cwd, "a.ts")]: {
          statementMap: { "0": span(1, 1), "1": span(2, 2) },
          s: { "0": 1, "1": 1 },
        },
        [path.join(cwd, "z.ts")]: {
          statementMap: { "0": span(1, 3) },
          s: { "0": 1 },
        },
      };
      const ranges = rangesFromCoverage(coverage, cwd, []);
      expect(ranges).toEqual(["a.ts:1-2", "z.ts:1-3"]);

      const counted = await countMutantLines(ranges, cwd);
      const [first, second] = counted;
      expect(first.count).toBeLessThanOrEqual(100);
      expect(second.count).toBeLessThanOrEqual(100);
      expect(first.count + second.count).toBeGreaterThan(100);

      expect({
        without: planStrykerRun(counted, 100),
        with: planStrykerRun(counted, 100, ["z.ts:1-3"]),
      }).toEqual({
        without: { kept: ["a.ts:1-1"], dropped: ["a.ts:2-2", "z.ts:1-3"], startable: true },
        with: { kept: ["a.ts:1-1", "z.ts:1-3"], dropped: ["a.ts:2-2"], startable: true },
      });
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});

describe("test:mutate CLI: --prefer", () => {
  const script = fileURLToPath(new URL("./mutate-diff.ts", import.meta.url));
  const tsx = path.resolve("node_modules/.bin/tsx");
  const usage =
    "\nUsage: pnpm test:mutate [--base <ref>] [--mutate <file:start-end>[,...]] [--prefer <file:start-end>[,...]]\n";
  const heavy = `export const total = ${Array.from({ length: 505 }, () => "a").join(" + ")};`;

  function runCli(
    files: Record<string, string>,
    args: string[],
    existingDirectory?: string,
    envOverride: NodeJS.ProcessEnv = {},
  ) {
    const cwd = existingDirectory ?? mkdtempSync(path.join(tmpdir(), "mutate-cli-"));
    try {
      for (const [name, contents] of Object.entries(files)) {
        mkdirSync(path.dirname(path.join(cwd, name)), { recursive: true });
        writeFileSync(path.join(cwd, name), contents);
      }
      const env: NodeJS.ProcessEnv = { ...process.env, ...envOverride };
      for (const name of ["GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE"]) delete env[name];
      const result = spawnSync(tsx, [script, ...args], { cwd, encoding: "utf8", env });
      const summaryFile = path.join(cwd, ".scratch", "mutation", "summary.json");
      const summary = existsSync(summaryFile) ? readFileSync(summaryFile, "utf8") : null;
      return { status: result.status, stdout: result.stdout, stderr: result.stderr, summary };
    } finally {
      if (existingDirectory === undefined) rmSync(cwd, { recursive: true, force: true });
    }
  }

  const truncated = (preferNotCovered: string[]) => ({
    status: "truncated",
    base: null,
    scope: ["f.ts:1-2"],
    dropped: ["f.ts:1-2"],
    command: null,
    elapsedMs: null,
    mutants: 0,
    score: null,
    survivors: [],
    exitCode: null,
    stderrTail: null,
    preferNotCovered,
  });
  const files = { "f.ts": `// comment\n${heavy}\n` };

  it("test:mutate CLI: --prefer", () => {
    const first = runCli(files, ["--mutate", "f.ts:1-2", "--prefer", "f.ts:2-2"]);
    const second = runCli(files, ["--mutate", "f.ts:1-2", "--prefer", "f.ts:2-2,g.ts:701-701"]);
    const noScope = runCli(
      { "f.ts": "// only a comment\n" },
      ["--mutate", "f.ts:1-1", "--prefer", "f.ts:1-1,g.ts:5-9"],
    );
    const noPrefer = runCli(files, ["--mutate", "f.ts:1-2"]);
    const mixedPrefer = runCli({}, ["--mutate", "f.ts:1-2", "--prefer", "f.ts:2-2,bad"]);
    const badPrefer = runCli({}, ["--prefer", "server/a.ts"]);
    const badBoth = runCli({}, ["--mutate", "x", "--prefer", "y"]);
    const emptyPrefer = runCli({}, ["--prefer", ""]);

    expect({
      first: [first.status, JSON.parse(first.stdout)],
      second: [second.status, JSON.parse(second.stdout)],
      noScope: [noScope.status, JSON.parse(noScope.stdout)],
      noPrefer: [noPrefer.status, JSON.parse(noPrefer.stdout)],
      mixedPrefer: [mixedPrefer.status, mixedPrefer.stdout, mixedPrefer.stderr],
      badPrefer: [badPrefer.status, badPrefer.stdout, badPrefer.stderr],
      badBoth: [badBoth.status, badBoth.stdout, badBoth.stderr],
      emptyPrefer: [emptyPrefer.status, emptyPrefer.stdout, emptyPrefer.stderr],
    }).toEqual({
      first: [0, truncated([])],
      second: [0, truncated(["g.ts:701-701"])],
      noScope: [
        0,
        {
          status: "no-scope",
          base: null,
          scope: ["f.ts:1-1"],
          dropped: [],
          command: null,
          elapsedMs: null,
          mutants: 0,
          score: null,
          survivors: [],
          exitCode: null,
          stderrTail: null,
          preferNotCovered: ["g.ts:5-9"],
        },
      ],
      noPrefer: [0, { ...truncated([]), dropped: ["f.ts:2-2"] }],
      mixedPrefer: [1, "", `--prefer takes comma-separated file:start-end ranges.${usage}`],
      badPrefer: [1, "", `--prefer takes comma-separated file:start-end ranges.${usage}`],
      badBoth: [1, "", `--mutate takes comma-separated file:start-end ranges.${usage}`],
      emptyPrefer: [1, "", `--prefer takes comma-separated file:start-end ranges.${usage}`],
    });
  });

  describe("test:mutate CLI: bad input", () => {
    const repos = useTempGitRepos();
    const stale = { ".scratch/mutation/summary.json": '{"status":"ok","stale":true}\n' };

    const runnerFailed = (base: string | null) => ({
      status: "runner-failed",
      base,
      scope: [],
      dropped: [],
      command: null,
      elapsedMs: null,
      mutants: null,
      score: null,
      survivors: null,
      exitCode: null,
      preferNotCovered: null,
    });

    function failedSummary(result: ReturnType<typeof runCli>) {
      expect(result.stdout).not.toBe("");
      const { stderrTail, ...rest } = JSON.parse(result.stdout);
      return { exit: result.status, rest, stderrTail, file: JSON.parse(result.summary ?? "null") };
    }

    it("nonexistent --mutate file", () => {
      for (const files of [{}, stale]) {
        const result = runCli(files, ["--mutate", "nope.ts:1-2"]);
        const { exit, rest, stderrTail, file } = failedSummary(result);
        expect(exit).toBe(1);
        expect(rest).toEqual(runnerFailed(null));
        expect(stderrTail).toMatch(/^ENOENT: no such file or directory, open '.*nope\.ts'$/);
        expect(file).toEqual({ ...rest, stderrTail });
      }
    });

    it("unknown --base", () => {
      for (const files of [{}, stale]) {
        const root = repos.create({ files: { "f.ts": "export const a = 1;\n" } });
        const result = runCli(files, ["--base", "no-such-ref"], root);
        const { exit, rest, stderrTail, file } = failedSummary(result);
        expect(exit).toBe(1);
        expect(rest).toEqual(runnerFailed("no-such-ref"));
        expect(stderrTail).toMatch(/no-such-ref\.\.\.HEAD/);
        expect(file).toEqual({ ...rest, stderrTail });
      }
    });

    it("a stale summary is deleted when the run emits nothing", () => {
      const badRange = runCli(
        { ...stale, "f.ts": "// only a comment\n" },
        ["--mutate", "f.ts:1-1", "--prefer", "bad"],
      );
      const bogus = runCli(stale, ["--bogus"]);
      expect({
        badRange: [badRange.status, badRange.stdout, badRange.stderr, badRange.summary],
        bogus: [bogus.status === 0, bogus.summary],
      }).toEqual({
        badRange: [1, "", `--prefer takes comma-separated file:start-end ranges.${usage}`, null],
        bogus: [false, null],
      });
    });

    it("a valid run after a stale summary", () => {
      const result = runCli({ ...stale, "f.ts": "// only a comment\n" }, ["--mutate", "f.ts:1-1"]);
      expect(result.status).toBe(0);
      const summary = JSON.parse(result.stdout);
      expect(summary).toMatchObject({ status: "no-scope", mutants: 0, scope: ["f.ts:1-1"], preferNotCovered: [] });
      expect(JSON.parse(result.summary ?? "null")).toEqual(summary);
    });
  });
});

describe("main: every emit takes preferNotCovered from preferNotCoveredFor", () => {
  it("main: every emit takes preferNotCovered from preferNotCoveredFor", () => {
    const source = readFileSync(fileURLToPath(new URL("./mutate-diff.ts", import.meta.url)), "utf8");
    const main = source.slice(source.indexOf("async function main"));
    const calls: string[] = [];
    for (const match of main.matchAll(/emit\(\s*summarize\(/g)) {
      const open = match.index! + "emit".length;
      let depth = 0;
      let end = open;
      for (let i = open; i < main.length; i++) {
        if (main[i] === "(") depth++;
        if (main[i] === ")" && --depth === 0) {
          end = i;
          break;
        }
      }
      calls.push(main.slice(open, end + 1));
    }
    const withHelper = calls.filter((call) => call.includes("preferNotCovered: preferNotCoveredFor("));
    expect(withHelper).toEqual(calls);
    expect(calls.length).toBe(5);
    expect(calls.map((call) => /preferNotCovered: preferNotCoveredFor\(([^)]*)\)/.exec(call)?.[1])).toEqual([
      "null, prefer",
      "counted, prefer",
      "counted, prefer",
      "counted, prefer",
      "null, prefer",
    ]);
  });
});

describe("main: the Stryker command comes only from strykerArgs", () => {
  it("main: the Stryker command comes only from strykerArgs", () => {
    const source = readFileSync(fileURLToPath(new URL("./mutate-diff.ts", import.meta.url)), "utf8");
    const main = source.slice(source.indexOf("async function main"));
    expect({
      declaration: main.split("let testFiles: string[] = [];").length - 1,
      assignments: main.split("testFiles = scope.testFiles;").length - 1,
      calls: main.split("strykerArgs(").length - 1,
      call: main.split("strykerArgs(kept, testFiles)").length - 1,
      literal: main.includes('"stryker"'),
    }).toEqual({ declaration: 1, assignments: 2, calls: 1, call: 1, literal: false });
  });
});
