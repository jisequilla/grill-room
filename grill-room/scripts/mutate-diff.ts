import { type ChildProcess, execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

import { Instrumenter } from "@stryker-mutator/instrumenter";
import { calculateMetrics } from "mutation-testing-metrics";

const CAP = 100;
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
const HUNK_HEADER = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/;
const RANGE_ARGUMENT = /^(.+):(\d+)-(\d+)$/;

export const isTestSidePath = (file: string): boolean => TEST_SIDE.test(file);
export const isSourcePath = (file: string): boolean =>
  SOURCE_EXTENSION.test(file) && !isTestSidePath(file);

export function isEntryPoint(importMetaUrl: string, argv1: string | undefined): boolean {
  return argv1 !== undefined && importMetaUrl === pathToFileURL(argv1).href;
}

export type Scope =
  | { kind: "ranges"; ranges: string[] }
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

export function rangesFromDiff(diffText: string): string[] {
  return parseDiff(diffText)
    .filter((file) => isSourcePath(file.path))
    .flatMap((file) => file.added.map((range) => `${file.path}:${range.start}-${range.end}`));
}

function testFilesFromDiff(diffText: string): string[] {
  return parseDiff(diffText)
    .map((file) => file.path)
    .filter((file) => TEST_FILE.test(file) && !/(^|\/)e2e\//.test(file));
}

function gitDiff(base: string, cwd: string): string {
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const name of ["GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE"]) delete env[name];
  return execFileSync(
    "git",
    ["diff", "--relative", "--no-renames", "--unified=0", `${base}...HEAD`],
    { cwd, env, encoding: "utf8", maxBuffer: 256 * 1024 * 1024 },
  );
}

export function scopeFor(base: string, cwd: string): Scope {
  const diffText = gitDiff(base, cwd);
  const ranges = rangesFromDiff(diffText);
  if (ranges.length > 0) return { kind: "ranges", ranges };
  const testFiles = testFilesFromDiff(diffText);
  if (testFiles.length > 0) return { kind: "coverage", testFiles };
  return { kind: "none" };
}

interface IstanbulFileCoverage {
  statementMap: Record<string, { start: { line: number }; end: { line: number } }>;
  s: Record<string, number>;
}

export function rangesFromCoverage(
  coverage: Record<string, IstanbulFileCoverage>,
  root: string,
): string[] {
  const ranges: string[] = [];
  for (const [absolute, file] of Object.entries(coverage)) {
    const relative = path.relative(root, absolute);
    if (relative.startsWith("..") || path.isAbsolute(relative)) continue;
    const posix = relative.split(path.sep).join("/");
    if (!isSourcePath(posix)) continue;
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
  let total = 0;
  let stopAt = lines.length;
  for (let i = 0; i < lines.length; i++) {
    if (total + lines[i].count > cap) {
      stopAt = i;
      break;
    }
    total += lines[i].count;
  }
  return {
    kept: mergeLines(lines.slice(0, stopAt)),
    dropped: mergeLines(lines.slice(stopAt)),
  };
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
  };
  const unknown = { mutants: null, score: null, survivors: null };

  if (run.outcome === "no-scope") {
    return { status: "no-scope", ...shared, mutants: 0, score: null, survivors: [] };
  }
  if (run.outcome === "nothing-kept") {
    return { status: "truncated", ...shared, mutants: 0, score: null, survivors: [] };
  }
  if (run.outcome === "overrun") return { status: "overrun", ...shared, ...unknown };
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

async function countMutantLines(ranges: string[], cwd: string): Promise<LineCount[]> {
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
      const count = perLine.get(key);
      if (count && !seen.has(key)) {
        seen.add(key);
        counted.push({ file, line, count });
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
    `${message}\nUsage: pnpm test:mutate [--base <ref>] [--mutate <file:start-end>[,...]]\n`,
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
  const { values } = parseArgs({
    options: { base: { type: "string" }, mutate: { type: "string" } },
    strict: true,
  });
  const cwd = process.cwd();

  let base: string | null = null;
  let scope: Scope;
  if (values.mutate !== undefined) {
    const ranges = values.mutate.split(",");
    if (ranges.some((range) => !RANGE_ARGUMENT.test(range))) {
      usageError("--mutate takes comma-separated file:start-end ranges.");
    }
    scope = { kind: "ranges", ranges };
  } else {
    base = values.base ?? DEFAULT_BASE;
    scope = scopeFor(base, cwd);
  }

  const empty: RunRecord = {
    outcome: "no-scope",
    base,
    scope: [],
    dropped: [],
    command: null,
    elapsedMs: null,
    exitCode: null,
    stderrTail: null,
  };

  let ranges: string[] = [];
  if (scope.kind === "ranges") {
    ranges = scope.ranges;
  } else if (scope.kind === "coverage") {
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
        }),
        cwd,
      );
      return;
    }
    ranges = rangesFromCoverage(JSON.parse(readFileSync(coverageFile, "utf8")), cwd);
  }

  const counted = ranges.length > 0 ? await countMutantLines(ranges, cwd) : [];
  if (counted.length === 0) {
    emit(summarize(null, { ...empty, scope: ranges }), cwd);
    return;
  }

  const { kept, dropped } = trimToCap(counted, CAP);
  if (kept.length === 0) {
    emit(summarize(null, { ...empty, outcome: "nothing-kept", scope: ranges, dropped }), cwd);
    return;
  }

  rmSync(path.join(cwd, STRYKER_REPORT_FILE), { force: true });
  const args = ["pnpm", "exec", "stryker", "run", "--mutate", kept.join(",")];
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
    }),
    cwd,
  );
}

if (isEntryPoint(import.meta.url, process.argv[1])) {
  void main();
}
