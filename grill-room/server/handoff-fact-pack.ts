import { lstatSync, readFileSync, realpathSync, statSync } from "node:fs";
import path from "node:path";

import { runGit } from "./git.js";
import { SCOUT_SECRET_FILE_PATTERNS } from "./interviewer/claude-cli.js";
import { isUnderFolder } from "./project-facts.js";
import { suggestVerifyCommand } from "./projects.js";
import { lineCount } from "./scout-report.js";

export const MAX_FACT_PACK_FILES = 3000;
export const MAX_FACT_PACK_DOC_LINES = 400;

const NAMED_DOCS = ["CLAUDE.md", "AGENTS.md", "package.json"] as const;

export interface HandoffFactPackDoc {
  /** The real file's path relative to the root first, then the other names that lead to it. */
  paths: string[];
  lines: string[];
  truncated: boolean;
}

export interface HandoffFactPack {
  trackedFiles: string[];
  trackedFilesOmitted: number;
  namedDocs: HandoffFactPackDoc[];
  verifyCommand: { command: string; source: "registered" | "suggested" } | null;
}

const SECRET_NAME_MATCHERS = SCOUT_SECRET_FILE_PATTERNS.map(
  (pattern) =>
    new RegExp(
      `^${pattern
        .split("*")
        .map((piece) => piece.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
        .join("[^/]*")}$`,
    ),
);

function isSecretFileName(basename: string): boolean {
  return SECRET_NAME_MATCHERS.some((matcher) => matcher.test(basename));
}

function existsInWorkingTree(root: string, relative: string): boolean {
  try {
    lstatSync(path.join(root, relative));
    return true;
  } catch {
    return false;
  }
}

async function collectTrackedFiles(
  root: string,
  excludeFolder: string | undefined,
): Promise<Pick<HandoffFactPack, "trackedFiles" | "trackedFilesOmitted">> {
  const result = await runGit(root, ["ls-files", "-z"]);
  if (result.exitCode !== 0) {
    throw new Error(
      `git ls-files failed in ${root}: ${result.stderr.trim().split("\n")[0] ?? ""}`,
    );
  }
  const listable = result.stdout
    .split("\0")
    .filter((entry) => entry.length > 0)
    .filter((entry) => excludeFolder === undefined || !isUnderFolder(entry, excludeFolder))
    .filter((entry) => !isSecretFileName(path.posix.basename(entry)))
    .filter((entry) => existsInWorkingTree(root, entry))
    .sort();
  return {
    trackedFiles: listable.slice(0, MAX_FACT_PACK_FILES),
    trackedFilesOmitted: Math.max(0, listable.length - MAX_FACT_PACK_FILES),
  };
}

function isInside(realRoot: string, candidate: string): boolean {
  const relative = path.relative(realRoot, candidate);
  return (
    relative !== "" &&
    relative !== ".." &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  );
}

function readableDoc(realRoot: string, name: string): { relative: string; text: string } | null {
  try {
    const real = realpathSync(path.join(realRoot, name));
    if (!isInside(realRoot, real)) return null;
    const relative = path.relative(realRoot, real).split(path.sep).join("/");
    if (relative === ".git" || relative.startsWith(".git/")) return null;
    if (isSecretFileName(path.posix.basename(relative))) return null;
    if (!statSync(real).isFile()) return null;
    return { relative, text: readFileSync(real, "utf8") };
  } catch {
    return null;
  }
}

function collectNamedDocs(root: string): HandoffFactPackDoc[] {
  let realRoot: string;
  try {
    realRoot = realpathSync(root);
  } catch {
    return [];
  }
  const byRealPath = new Map<string, { names: string[]; text: string }>();
  for (const name of NAMED_DOCS) {
    const doc = readableDoc(realRoot, name);
    if (!doc) continue;
    const entry = byRealPath.get(doc.relative);
    if (entry) entry.names.push(name);
    else byRealPath.set(doc.relative, { names: [name], text: doc.text });
  }
  return [...byRealPath].map(([relative, { names, text }]) => {
    const lines = text.length === 0 ? [] : text.split("\n");
    if (text.endsWith("\n")) lines.pop();
    return {
      paths: [relative, ...names.filter((name) => name !== relative)],
      lines: lines.slice(0, MAX_FACT_PACK_DOC_LINES),
      truncated: lineCount(text) > MAX_FACT_PACK_DOC_LINES,
    };
  });
}

function chooseVerifyCommand(
  root: string,
  registered: string | null | undefined,
): HandoffFactPack["verifyCommand"] {
  if (registered && registered.trim().length > 0) {
    return { command: registered.trim(), source: "registered" };
  }
  const suggested = suggestVerifyCommand(root);
  return suggested ? { command: suggested, source: "suggested" } : null;
}

/**
 * What the handoff scout would otherwise spend tool calls finding out: the
 * files git tracks (secret files left out), the root documents it always
 * reads, and the command that verifies the project.
 */
export async function collectHandoffFactPack(
  root: string,
  options: { excludeFolder?: string; verifyCommand?: string | null } = {},
): Promise<HandoffFactPack> {
  const tracked = await collectTrackedFiles(root, options.excludeFolder);
  return {
    ...tracked,
    namedDocs: collectNamedDocs(root),
    verifyCommand: chooseVerifyCommand(root, options.verifyCommand),
  };
}
