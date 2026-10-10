import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { useTempGitRepos } from "../test/git-repos";
import {
  countMutantLines,
  isEntryPoint,
  planStrykerRun,
  rangesFromCoverage,
  rangesFromDiff,
  scopeFor,
  summarize,
  trimToCap,
  type RunRecord,
  type StrykerReport,
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
    ["tsx", diffOf("app/x.tsx", ["@@ -5,0 +6,1 @@"]), ["app/x.tsx:6-6"]],
    ["mjs", diffOf("scripts/tool.mjs", ["@@ -1,0 +1,2 @@"]), ["scripts/tool.mjs:1-2"]],
    ["js", diffOf("shared/old.js", ["@@ -4,0 +5,1 @@"]), ["shared/old.js:5-5"]],
    ["markdown", diffOf("docs/notes.md", ["@@ -1,0 +1,2 @@"]), []],
    ["cjs", diffOf("server/c.cjs", ["@@ -2,0 +3,1 @@"]), ["server/c.cjs:3-3"]],
    ["jsx", diffOf("app/w.jsx", ["@@ -7,0 +8,2 @@"]), ["app/w.jsx:8-9"]],
    ["snapshot", diffOf("fixtures/out.snap", ["@@ -1,0 +1,2 @@"]), []],
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
    expect(rows.map(([name, diff]) => [name, rangesFromDiff(diff)])).toEqual(
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
        "key order kept",
        {
          [`${root}/server/q.ts`]: coverageFor([[4, 4, 1]]),
          [`${root}/app/c.ts`]: coverageFor([[2, 2, 1]]),
        },
        ["server/q.ts:4-4", "app/c.ts:2-2"],
      ],
    ];
    expect(cases.map(([name, coverage]) => [name, rangesFromCoverage(coverage, root)])).toEqual(
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

    expect(summarize(report, run)).toEqual({ status: "ok", dropped: [], ...finished });
    expect(summarize(report, { ...run, dropped: ["server/a.ts:30-31"] })).toEqual({
      status: "truncated",
      dropped: ["server/a.ts:30-31"],
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
    });
    expect(
      summarize(null, { ...run, outcome: "runner-failed", exitCode: 1, stderrTail: "boom" }),
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
    expect(scopeFor(base, root)).toEqual({ kind: "ranges", ranges: ["server/a.ts:2-3"] });
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
    expect(scopeFor(base, app)).toEqual({ kind: "ranges", ranges: ["server/a.ts:2-2"] });
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
      return [row.name, scopeFor(base, root)];
    });
    expect(actual).toEqual(rows.map((row) => [row.name, row.expected]));
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
