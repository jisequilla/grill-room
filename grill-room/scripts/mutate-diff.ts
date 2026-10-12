import { type ChildProcess, execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

import { Instrumenter } from "@stryker-mutator/instrumenter";
import { calculateMetrics } from "mutation-testing-metrics";

export const CAP = 500;
const OVERRUN_MS = 10 * 60 * 1000;
const STDERR_TAIL_LINES = 20;
const DEFAULT_BASE = "origin/main";
const OUTPUT_DIR = path.join(".scratch", "mutation");
const SUMMARY_FILE = path.join(OUTPUT_DIR, "summary.json");
const STRYKER_REPORT_FILE = path.join(OUTPUT_DIR, "stryker-report.json");
const COVERAGE_DIR = path.join(OUTPUT_DIR, "coverage");

const TEST_SIDE = /\.(test|spec)\.[cm]?[jt]sx?$|\.snap$|(^|\/)(e2e|test|__snapshots__)\//;
const SOURCE_EXTENSION = /\.(ts|tsx|js|jsx|mjs|cjs)$/;
const TEST_FILE = /\.(test|spec)\.[cm]?[jt]sx?$/;
// Tooling configuration is read by the tools, not imported by any test, so
// Stryker would find no test to run against its mutants and stop with
// "No tests were executed". Paths are relative to grill-room/.
const TOOLING_CONFIGS = new Set([
  "agent-native.config.ts",
  "playwright.config.ts",
  "react-router.config.ts",
  "stryker.config.mjs",
  "vite.config.ts",
  "vitest.config.ts",
]);
const HUNK_HEADER = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/;
const RANGE_ARGUMENT = /^(.+):(\d+)-(\d+)$/;

export const isTestSidePath = (file: string): boolean => TEST_SIDE.test(file);
export const isSourcePath = (file: string): boolean =>
  SOURCE_EXTENSION.test(file) && !isTestSidePath(file) && !TOOLING_CONFIGS.has(file);

export function isEntryPoint(importMetaUrl: string, argv1: string | undefined): boolean {
  return argv1 !== undefined && importMetaUrl === pathToFileURL(argv1).href;
}

export type Scope =
  | { kind: "ranges"; ranges: string[]; testFiles: string[] }
  | { kind: "coverage"; testFiles: string[] }
  | { kind: "none" };

interface DiffFile {
  path: string;
  added: Array<{ start: number; end: number }>;
}

function parseDiff(diffText: string): DiffFile[] {
  const files: DiffFile[] = [];
  let current: DiffFile | null = null;
  for (const line of diffText.split("\n")) {
    if (line.startsWith("diff --git ")) {
      current = null;
    } else if (line.startsWith("+++ ")) {
      const target = line.slice(4).split("\t")[0];
      current = target.startsWith("b/") ? { path: target.slice(2), added: [] } : null;
      if (current) files.push(current);
    } else if (current) {
      const hunk = HUNK_HEADER.exec(line);
      if (hunk) {
        const start = Number(hunk[1]);
        const count = hunk[2] === undefined ? 1 : Number(hunk[2]);
        if (count > 0) current.added.push({ start, end: start + count - 1 });
      }
    }
  }
  return files;
}

export type TestIndex = Array<{ path: string; text: string }>;

function gitEnvironment(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const name of ["GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE"]) delete env[name];
  return env;
}

const isUnitTestFile = (file: string): boolean => TEST_FILE.test(file) && !/(^|\/)e2e\//.test(file);

export function loadTestIndex(root: string): TestIndex {
  const listing = execFileSync("git", ["ls-files", "-z"], {
    cwd: root,
    env: gitEnvironment(),
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
  });
  const index: TestIndex = [];
  for (const file of listing.split("\0").filter(isUnitTestFile)) {
    const absolute = path.join(root, file);
    try {
      if (statSync(absolute).isFile()) index.push({ path: file, text: readFileSync(absolute, "utf8") });
    } catch {
      continue;
    }
  }
  return index;
}

const escapeRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// A test references `foo.tsx` loosely: "/foo" followed by a quote, dot or slash.
// It errs toward keeping a file; a false keep costs only NoCoverage survivors.
export function inMutationScope(file: string, index: TestIndex): boolean {
  if (file.startsWith("app/i18n/")) return false;
  if (!file.endsWith(".tsx")) return true;
  const slash = file.lastIndexOf("/");
  const directory = file.slice(0, slash + 1);
  const base = file.slice(slash + 1, -".tsx".length);
  const sibling = new RegExp(`^${escapeRegExp(directory + base)}\\.(test|spec)\\.[cm]?[jt]sx?$`);
  const reference = new RegExp(`[/'"]${escapeRegExp(base)}['"./]`);
  return index.some((test) => sibling.test(test.path) || reference.test(test.text));
}

export function rangesFromDiff(diffText: string, index: TestIndex): string[] {
  return parseDiff(diffText)
    .filter((file) => isSourcePath(file.path) && inMutationScope(file.path, index))
    .flatMap((file) => file.added.map((range) => `${file.path}:${range.start}-${range.end}`));
}

function testFilesFromDiff(diffText: string): string[] {
  return parseDiff(diffText)
    .map((file) => file.path)
    .filter(isUnitTestFile);
}

function gitDiff(base: string, cwd: string): string {
  const env = gitEnvironment();
  return execFileSync(
    "git",
    ["diff", "--relative", "--no-renames", "--unified=0", `${base}...HEAD`],
    { cwd, env, encoding: "utf8", maxBuffer: 256 * 1024 * 1024 },
  );
}

function hasOwnTest(file: string, testFiles: string[]): boolean {
  const slash = file.lastIndexOf("/");
  const directory = file.slice(0, slash + 1);
  const name = file.slice(slash + 1);
  const stem = name.slice(0, name.lastIndexOf("."));
  const own = new RegExp(`^${escapeRegExp(directory + stem)}\\.(test|spec)\\.[cm]?[jt]sx?$`);
  return testFiles.some((test) => own.test(test));
}

export function scopeFor(base: string, cwd: string, index: TestIndex): Scope {
  const diffText = gitDiff(base, cwd);
  const changedTests = testFilesFromDiff(diffText);
  const hasSourceChange = parseDiff(diffText).some(
    (file) => isSourcePath(file.path) && file.added.length > 0,
  );
  if (hasSourceChange) {
    const ranges = rangesFromDiff(diffText, index);
    if (ranges.length === 0) return { kind: "none" };
    const keptFiles = [...new Set(ranges.map((range) => parseRange(range).file))];
    const everyFileHasItsTest = keptFiles.every((file) => hasOwnTest(file, changedTests));
    return { kind: "ranges", ranges, testFiles: everyFileHasItsTest ? changedTests : [] };
  }
  if (changedTests.length > 0) return { kind: "coverage", testFiles: changedTests };
  return { kind: "none" };
}

interface IstanbulFileCoverage {
  statementMap: Record<string, { start: { line: number }; end: { line: number } }>;
  s: Record<string, number>;
}

export function rangesFromCoverage(
  coverage: Record<string, IstanbulFileCoverage>,
  root: string,
  index: TestIndex,
): string[] {
  const ranges: string[] = [];
  for (const [absolute, file] of Object.entries(coverage)) {
    const relative = path.relative(root, absolute);
    if (relative.startsWith("..") || path.isAbsolute(relative)) continue;
    const posix = relative.split(path.sep).join("/");
    if (!isSourcePath(posix) || !inMutationScope(posix, index)) continue;
    const covered = new Set<number>();
    for (const [id, span] of Object.entries(file.statementMap)) {
      if ((file.s[id] ?? 0) <= 0) continue;
      for (let line = span.start.line; line <= span.end.line; line++) covered.add(line);
    }
    const lines = [...covered].sort((a, b) => a - b);
    let start = 0;
    for (let i = 0; i < lines.length; i++) {
      start = start || lines[i];
      if (lines[i + 1] !== lines[i] + 1) {
        ranges.push(`${posix}:${start}-${lines[i]}`);
        start = 0;
      }
    }
  }
  return ranges;
}

export function strykerArgs(kept: string[], testFiles: string[]): string[] {
  const args = ["pnpm", "exec", "stryker", "run", "--mutate", kept.join(",")];
  if (testFiles.length > 0) args.push("--testFiles", testFiles.join(","));
  return args;
}

export interface LineCount {
  file: string;
  line: number;
  count: number;
}

function mergeLines(lines: LineCount[]): string[] {
  const ranges: string[] = [];
  let open: { file: string; start: number; end: number } | null = null;
  const flush = () => {
    if (open) ranges.push(`${open.file}:${open.start}-${open.end}`);
  };
  for (const { file, line } of lines) {
    if (open && open.file === file && open.end + 1 === line) {
      open.end = line;
    } else {
      flush();
      open = { file, start: line, end: line };
    }
  }
  flush();
  return ranges;
}

export function trimToCap(
  lines: LineCount[],
  cap: number,
): { kept: string[]; dropped: string[] } {
  const { keptLines, droppedLines } = splitAtCap(lines, cap);
  return { kept: mergeLines(keptLines), dropped: mergeLines(droppedLines) };
}

function splitAtCap(
  lines: LineCount[],
  cap: number,
): { keptLines: LineCount[]; droppedLines: LineCount[] } {
  let total = 0;
  let stopAt = lines.length;
  for (let i = 0; i < lines.length; i++) {
    if (total + lines[i].count > cap) {
      stopAt = i;
      break;
    }
    total += lines[i].count;
  }
  return { keptLines: lines.slice(0, stopAt), droppedLines: lines.slice(stopAt) };
}

function inAnyRange(line: LineCount, ranges: Array<{ file: string; start: number; end: number }>) {
  return ranges.some(
    (range) => range.file === line.file && line.line >= range.start && line.line <= range.end,
  );
}

export function planStrykerRun(
  lines: LineCount[],
  cap: number,
  prefer: string[] = [],
): { kept: string[]; dropped: string[]; startable: boolean } {
  const preferred = prefer.map(parseRange);
  const isPreferred = (line: LineCount) => inAnyRange(line, preferred);
  const ranked = [...lines.filter(isPreferred), ...lines.filter((line) => !isPreferred(line))];
  const { keptLines } = splitAtCap(ranked, cap);
  const keptSet = new Set(keptLines);
  const inScopeOrder = lines.filter((line) => keptSet.has(line));
  const droppedLines = lines.filter((line) => !keptSet.has(line));
  return {
    kept: mergeLines(inScopeOrder),
    dropped: mergeLines(droppedLines),
    startable: inScopeOrder.some((entry) => entry.count > 0),
  };
}

export function uncoveredPreferred(lines: LineCount[], prefer: string[]): string[] {
  return prefer.filter((range) => {
    const parsed = [parseRange(range)];
    return !lines.some((line) => inAnyRange(line, parsed));
  });
}

export function preferNotCoveredFor(counted: LineCount[] | null, prefer: string[]): string[] | null {
  return counted === null ? null : uncoveredPreferred(counted, prefer);
}

export interface RunRecord {
  outcome: "finished" | "overrun" | "runner-failed" | "nothing-kept" | "no-scope";
  base: string | null;
  scope: string[];
  dropped: string[];
  command: string | null;
  elapsedMs: number | null;
  exitCode: number | null;
  stderrTail: string | null;
  preferNotCovered: string[] | null;
}

export interface StrykerReport {
  files: Record<
    string,
    {
      mutants: Array<{
        mutatorName: string;
        status: string;
        location: { start: { line: number } };
      }>;
    }
  >;
}

export interface Survivor {
  file: string;
  line: number;
  mutator: string;
  status: string;
}

export interface Summary {
  status: "ok" | "truncated" | "overrun" | "runner-failed" | "no-scope";
  base: string | null;
  scope: string[];
  dropped: string[];
  command: string | null;
  elapsedMs: number | null;
  mutants: number | null;
  score: number | null;
  survivors: Survivor[] | null;
  exitCode: number | null;
  stderrTail: string | null;
  preferNotCovered: string[] | null;
}

export function summarize(report: StrykerReport | null, run: RunRecord): Summary {
  const shared = {
    base: run.base,
    scope: run.scope,
    dropped: run.dropped,
    command: run.command,
    elapsedMs: run.elapsedMs,
    exitCode: run.exitCode,
    stderrTail: run.stderrTail,
    preferNotCovered: run.preferNotCovered,
  };
  const unknown = { mutants: null, score: null, survivors: null };

  if (run.outcome === "no-scope") {
    return { status: "no-scope", ...shared, mutants: 0, score: null, survivors: [] };
  }
  if (run.outcome === "nothing-kept") {
    return { status: "truncated", ...shared, mutants: 0, score: null, survivors: [] };
  }
  if (run.outcome === "overrun") {
    return { status: "overrun", ...shared, stderrTail: null, ...unknown };
  }
  if (run.outcome === "runner-failed" || report === null) {
    return { status: "runner-failed", ...shared, ...unknown };
  }

  const survivors: Survivor[] = [];
  let mutants = 0;
  for (const [file, result] of Object.entries(report.files)) {
    for (const mutant of result.mutants) {
      if (mutant.status === "Ignored") continue;
      mutants++;
      if (mutant.status === "Survived" || mutant.status === "NoCoverage") {
        survivors.push({
          file,
          line: mutant.location.start.line,
          mutator: mutant.mutatorName,
          status: mutant.status,
        });
      }
    }
  }
  const { mutationScore } = calculateMetrics(
    report.files as unknown as Parameters<typeof calculateMetrics>[0],
  ).metrics;
  return {
    status: run.dropped.length > 0 ? "truncated" : "ok",
    ...shared,
    mutants,
    score: mutationScore,
    survivors,
  };
}

function parseRange(range: string): { file: string; start: number; end: number } {
  const match = RANGE_ARGUMENT.exec(range);
  if (!match) throw new Error(`Invalid range: ${range}`);
  return { file: match[1], start: Number(match[2]), end: Number(match[3]) };
}

const silentLogger = {
  isTraceEnabled: () => false,
  isDebugEnabled: () => false,
  isInfoEnabled: () => false,
  isWarnEnabled: () => false,
  isErrorEnabled: () => false,
  isFatalEnabled: () => false,
  trace: () => {},
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
  fatal: () => {},
} as unknown as ConstructorParameters<typeof Instrumenter>[0];

export async function countMutantLines(ranges: string[], cwd: string): Promise<LineCount[]> {
  const parsed = ranges.map(parseRange);
  const perFile = new Map<string, typeof parsed>();
  for (const range of parsed) perFile.set(range.file, [...(perFile.get(range.file) ?? []), range]);

  const files = [...perFile].map(([name, fileRanges]) => ({
    name,
    content: readFileSync(path.join(cwd, name), "utf8"),
    mutate: fileRanges.map((range) => ({
      start: { line: range.start - 1, column: 0 },
      end: { line: range.end - 1, column: Number.MAX_SAFE_INTEGER },
    })),
  }));
  const result = await new Instrumenter(silentLogger).instrument(files, {
    plugins: null,
    excludedMutations: [],
    ignorers: [],
  });

  const perLine = new Map<string, number>();
  for (const mutant of result.mutants) {
    if (mutant.status === "Ignored") continue;
    const key = `${mutant.fileName}\0${mutant.location.start.line + 1}`;
    perLine.set(key, (perLine.get(key) ?? 0) + 1);
  }

  const counted: LineCount[] = [];
  const seen = new Set<string>();
  for (const { file, start, end } of parsed) {
    for (let line = start; line <= end; line++) {
      const key = `${file}\0${line}`;
      if (!seen.has(key)) {
        seen.add(key);
        counted.push({ file, line, count: perLine.get(key) ?? 0 });
      }
    }
  }
  return counted;
}

interface Finished {
  exitCode: number | null;
  timedOut: boolean;
  stderrTail: string;
}

function runInGroup(args: string[], cwd: string, timeoutMs: number): Promise<Finished> {
  return new Promise((resolve) => {
    const child: ChildProcess = spawn(args[0], args.slice(1), {
      cwd,
      detached: true,
      stdio: ["ignore", process.stderr.fd, "pipe"],
    });
    const stderrLines: string[] = [];
    child.stderr?.on("data", (chunk: Buffer) => {
      process.stderr.write(chunk);
      stderrLines.push(...chunk.toString().split("\n"));
      if (stderrLines.length > 500) stderrLines.splice(0, stderrLines.length - 500);
    });
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      try {
        process.kill(-child.pid!, "SIGTERM");
      } catch {
        child.kill("SIGTERM");
      }
    }, timeoutMs);
    const done = (exitCode: number | null) => {
      clearTimeout(timer);
      const tail = stderrLines.filter((line) => line.length > 0).slice(-STDERR_TAIL_LINES);
      resolve({ exitCode, timedOut, stderrTail: tail.join("\n") });
    };
    child.on("error", (error) => {
      stderrLines.push(String(error));
      done(1);
    });
    child.on("close", (code) => done(code));
  });
}

function usageError(message: string): never {
  process.stderr.write(
    `${message}\nUsage: pnpm test:mutate [--base <ref>] [--mutate <file:start-end>[,...]] [--prefer <file:start-end>[,...]]\n`,
  );
  process.exit(1);
}

function emit(summary: Summary, cwd: string): void {
  const json = JSON.stringify(summary, null, 2);
  mkdirSync(path.join(cwd, OUTPUT_DIR), { recursive: true });
  writeFileSync(path.join(cwd, SUMMARY_FILE), `${json}\n`);
  process.stdout.write(`${json}\n`);
}

async function main(): Promise<void> {
  const cwd = process.cwd();
  rmSync(path.join(cwd, SUMMARY_FILE), { force: true });
  const { values } = parseArgs({
    options: {
      base: { type: "string" },
      mutate: { type: "string" },
      prefer: { type: "string" },
    },
    strict: true,
  });

  const validRanges = (list: string[]) => list.every((range) => RANGE_ARGUMENT.test(range));
  if (values.mutate !== undefined && !validRanges(values.mutate.split(","))) {
    usageError("--mutate takes comma-separated file:start-end ranges.");
  }
  if (values.prefer !== undefined && !validRanges(values.prefer.split(","))) {
    usageError("--prefer takes comma-separated file:start-end ranges.");
  }
  const prefer = values.prefer === undefined ? [] : values.prefer.split(",");

  const base = values.mutate !== undefined ? null : (values.base ?? DEFAULT_BASE);
  const empty: RunRecord = {
    outcome: "no-scope",
    base,
    scope: [],
    dropped: [],
    command: null,
    elapsedMs: null,
    exitCode: null,
    stderrTail: null,
    preferNotCovered: [],
  };

  try {
    const index = values.mutate === undefined ? loadTestIndex(cwd) : [];
    const scope: Scope =
      values.mutate !== undefined
        ? { kind: "ranges", ranges: values.mutate.split(","), testFiles: [] }
        : scopeFor(base ?? DEFAULT_BASE, cwd, index);

    let ranges: string[] = [];
    let testFiles: string[] = [];
    if (scope.kind === "ranges") {
      ranges = scope.ranges;
      testFiles = scope.testFiles;
    } else if (scope.kind === "coverage") {
      testFiles = scope.testFiles;
      rmSync(path.join(cwd, COVERAGE_DIR), { recursive: true, force: true });
      const args = [
        "pnpm",
        "exec",
        "vitest",
        "--run",
        "--coverage.enabled",
        "--coverage.provider=v8",
        "--coverage.reporter=json",
        `--coverage.reportsDirectory=${COVERAGE_DIR}`,
        ...scope.testFiles,
      ];
      const started = Date.now();
      const finished = await runInGroup(args, cwd, OVERRUN_MS);
      const coverageFile = path.join(cwd, COVERAGE_DIR, "coverage-final.json");
      if (finished.exitCode !== 0 || !existsSync(coverageFile)) {
        emit(
          summarize(null, {
            ...empty,
            outcome: finished.timedOut ? "overrun" : "runner-failed",
            command: args.join(" "),
            elapsedMs: Date.now() - started,
            exitCode: finished.exitCode,
            stderrTail: finished.stderrTail,
            preferNotCovered: preferNotCoveredFor(null, prefer),
          }),
          cwd,
        );
        return;
      }
      ranges = rangesFromCoverage(JSON.parse(readFileSync(coverageFile, "utf8")), cwd, index);
    }

    const counted = ranges.length > 0 ? await countMutantLines(ranges, cwd) : [];
    if (!counted.some((entry) => entry.count > 0)) {
      emit(
        summarize(null, {
          ...empty,
          scope: ranges,
          preferNotCovered: preferNotCoveredFor(counted, prefer),
        }),
        cwd,
      );
      return;
    }

    const { kept, dropped, startable } = planStrykerRun(counted, CAP, prefer);
    if (!startable) {
      emit(
        summarize(null, {
          ...empty,
          outcome: "nothing-kept",
          scope: ranges,
          dropped,
          preferNotCovered: preferNotCoveredFor(counted, prefer),
        }),
        cwd,
      );
      return;
    }

    rmSync(path.join(cwd, STRYKER_REPORT_FILE), { force: true });
    const args = strykerArgs(kept, testFiles);
    const started = Date.now();
    const finished = await runInGroup(args, cwd, OVERRUN_MS);
    const reportFile = path.join(cwd, STRYKER_REPORT_FILE);
    const report: StrykerReport | null =
      !finished.timedOut && finished.exitCode === 0 && existsSync(reportFile)
        ? JSON.parse(readFileSync(reportFile, "utf8"))
        : null;
    const outcome = finished.timedOut ? "overrun" : report === null ? "runner-failed" : "finished";
    emit(
      summarize(report, {
        outcome,
        base,
        scope: ranges,
        dropped,
        command: args.join(" "),
        elapsedMs: Date.now() - started,
        exitCode: finished.exitCode,
        stderrTail: outcome === "finished" ? null : finished.stderrTail,
        preferNotCovered: preferNotCoveredFor(counted, prefer),
      }),
      cwd,
    );
  } catch (error) {
    emit(
      summarize(null, {
        ...empty,
        outcome: "runner-failed",
        stderrTail: error instanceof Error ? error.message : String(error),
        preferNotCovered: preferNotCoveredFor(null, prefer),
      }),
      cwd,
    );
    process.exitCode = 1;
  }
}

if (isEntryPoint(import.meta.url, process.argv[1])) {
  void main();
}
