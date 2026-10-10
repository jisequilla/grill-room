/**
 * The deterministic half of project grounding: facts about a registered
 * project's repository that the server can know for certain, collected with
 * the existing read-only git helper (`server/git.ts`) and plain file checks.
 * No model ever derives them.
 *
 * See `.grill-room/project-scout/spec.md` ("Server facts") and
 * `.grill-room/project-scout/issues/01-server-facts.md`.
 */
import {
  closeSync,
  lstatSync,
  openSync,
  readdirSync,
  readSync,
  realpathSync,
  statSync,
} from "node:fs";
import path from "node:path";

import { runGit } from "./git.js";

export type ProjectFactsErrorCode = "not-a-repo";

export interface ProjectFactsRefusal {
  errorCode: ProjectFactsErrorCode;
  message: string;
}

export interface ProjectRemote {
  name: string;
  url: string;
  type: "fetch" | "push";
}

/**
 * A plain, serializable snapshot of a project's repository at its root.
 * Ticket 03 stores this on the scout report and passes it to the scout turn
 * as-is.
 */
export interface ProjectServerFacts {
  /** null when the repository has no commits yet. */
  headCommit: string | null;
  /** null when the repository has no commits yet. */
  headBranch: string | null;
  remotes: ProjectRemote[];
  dirty: boolean;
  /** Most recent first; empty when the repository has no commits yet. */
  recentCommitSubjects: string[];
  hasAgentInstructions: boolean;
  /** Repo-relative path of whichever candidate exists, or null. */
  decisionsFolder: string | null;
  hasRulesFolder: boolean;
  /**
   * Project-relative paths of every `decisions.md` git tracks anywhere in the
   * project, sorted and uncapped. An untracked `decisions.md` is excluded, and
   * so is one under any folder passed in `excludeFolders`. The scout prompt
   * lists these as recorded decision sources.
   */
  decisionFiles: string[];
  /** The ADR convention found in `decisionsFolder`; null when there is no such folder. */
  adrConvention: AdrConvention | null;
}

export interface AdrConvention {
  /** Repo-relative, the same value as `decisionsFolder`. */
  folder: string;
  /** null when no numbering can be read with confidence. */
  numbering: {
    prefix: string;
    width: number;
    nextNumber: string;
    example: string;
  } | null;
  /** null when no file gives a template. */
  template: { source: string; headings: string[] } | null;
}

type Refused = { refusal: ProjectFactsRefusal };

function refuse(message: string): Refused {
  return { refusal: { errorCode: "not-a-repo", message } };
}

const DECISIONS_FOLDER_CANDIDATES = ["docs/decisions", "docs/adr", "adr"];

function directoryExists(candidate: string): boolean {
  try {
    return statSync(candidate).isDirectory();
  } catch {
    return false;
  }
}

function fileExists(candidate: string): boolean {
  try {
    return statSync(candidate).isFile();
  } catch {
    return false;
  }
}

function findDecisionsFolder(root: string): string | null {
  for (const candidate of DECISIONS_FOLDER_CANDIDATES) {
    if (directoryExists(path.join(root, candidate))) return candidate;
  }
  return null;
}

const NUMBERED_ADR_NAME = /^([A-Za-z][A-Za-z0-9]*-)?(\d{1,9})(?:[-_].*)?\.md$/i;
const DATED_NAME = /^\d{4}-\d{2}-\d{2}/;
const HEADING_READ_BYTES = 64 * 1024;

function isInside(parent: string, child: string): boolean {
  const relative = path.relative(parent, child);
  return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
}

function readHeadings(file: string): string[] {
  let descriptor: number | undefined;
  try {
    descriptor = openSync(file, "r");
    const buffer = Buffer.alloc(HEADING_READ_BYTES);
    const read = readSync(descriptor, buffer, 0, HEADING_READ_BYTES, 0);
    return buffer
      .subarray(0, read)
      .toString("utf8")
      .split(/\r?\n/)
      .filter((line) => line.startsWith("## "))
      .map((line) => line.slice(3).trim())
      .filter((heading) => heading.length > 0);
  } catch {
    return [];
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

/**
 * The numbering and template the repo's own ADRs follow, read from the top
 * level of its decisions folder. Deterministic and never throws: a folder that
 * is a symlink out of the repository, or cannot be listed, gives neither.
 */
export function detectAdrConvention(
  root: string,
  decisionsFolder: string | null,
): AdrConvention | null {
  if (decisionsFolder === null) return null;
  const folder = path.join(root, decisionsFolder);
  const nothing: AdrConvention = { folder: decisionsFolder, numbering: null, template: null };

  let names: string[];
  try {
    if (!isInside(realpathSync(root), realpathSync(folder))) return nothing;
    names = readdirSync(folder).filter((name) => /\.md$/i.test(name));
  } catch {
    return nothing;
  }
  names = names.filter((name) => {
    try {
      return lstatSync(path.join(folder, name)).isFile();
    } catch {
      return false;
    }
  });
  names.sort();

  const numbered = names
    .filter((name) => !/template/i.test(name) && !DATED_NAME.test(name))
    .flatMap((name) => {
      const match = NUMBERED_ADR_NAME.exec(name);
      return match
        ? [{ name, prefix: match[1] ?? "", value: Number(match[2]), digits: match[2].length }]
        : [];
    });

  let numbering: AdrConvention["numbering"] = null;
  let highest: (typeof numbered)[number] | undefined;
  if (numbered.length > 0 && numbered.every((file) => file.prefix === numbered[0].prefix)) {
    highest = numbered.reduce((best, file) => (file.value > best.value ? file : best));
    numbering = {
      prefix: highest.prefix,
      width: highest.digits,
      nextNumber: highest.prefix + String(highest.value + 1).padStart(highest.digits, "0"),
      example: highest.name,
    };
  }

  const sourceName =
    names.find((name) => /template/i.test(name)) ?? (numbering ? highest?.name : undefined);
  let template: AdrConvention["template"] = null;
  if (sourceName !== undefined) {
    const headings = readHeadings(path.join(folder, sourceName));
    if (headings.length > 0) {
      template = { source: `${decisionsFolder}/${sourceName}`, headings };
    }
  }
  return { folder: decisionsFolder, numbering, template };
}

const REMOTE_LINE = /^(\S+)\t(\S+)\s+\((fetch|push)\)$/;

/** A URL with a scheme, split before and after any userinfo in its authority. */
const URL_USERINFO = /^([A-Za-z][A-Za-z0-9+.-]*:\/\/)[^/]*@/;

/**
 * A remote URL with any userinfo (`user:token@`) removed from its authority.
 * A remote can carry a token, and these facts are stored and sent to a model,
 * so nothing downstream of this module ever sees one. scp-like remotes
 * (`git@host:path`) have no scheme and name only an SSH user; they pass as-is.
 */
export function stripRemoteCredentials(url: string): string {
  return url.replace(URL_USERINFO, "$1");
}

function parseRemotes(stdout: string): ProjectRemote[] {
  const remotes: ProjectRemote[] = [];
  for (const rawLine of stdout.split("\n")) {
    const match = REMOTE_LINE.exec(rawLine.trim());
    if (!match) continue;
    const [, name, url, type] = match;
    remotes.push({
      name,
      url: stripRemoteCredentials(url),
      type: type as "fetch" | "push",
    });
  }
  return remotes;
}

function parseCommitSubjects(stdout: string): string[] {
  return stdout.split("\n").filter((line) => line.length > 0);
}

function parseTrackedPaths(stdout: string): string[] {
  return stdout.split("\n").filter((line) => line.length > 0);
}

/**
 * Whether `filePath` (a project-relative path) sits at or under `folder` (a
 * project-relative folder), matching on the path segment boundary: excluding
 * `.scratch/a` must not exclude `.scratch/ab/decisions.md`.
 */
export function isUnderFolder(filePath: string, folder: string): boolean {
  const normalized = folder.replace(/\/+$/, "");
  return filePath === normalized || filePath.startsWith(`${normalized}/`);
}

/**
 * Collect a registered project's server facts from its root.
 *
 * A root that is no longer a git repository is refused with `not-a-repo`
 * before any of the other read-only git calls run. A repository that exists
 * but has no commits yet (an unborn branch) does not crash: `headCommit` and
 * `headBranch` come back null and `recentCommitSubjects` comes back empty,
 * since `git rev-parse HEAD` and `git log` both fail until the first commit.
 *
 * `excludeFolders` are project-relative folders whose `decisions.md` files
 * are left out of `decisionFiles`.
 */
export async function collectProjectFacts(
  root: string,
  excludeFolders: readonly string[] = [],
): Promise<{ facts: ProjectServerFacts } | Refused> {
  const insideWorkTree = await runGit(root, ["rev-parse", "--is-inside-work-tree"]);
  if (insideWorkTree.exitCode !== 0 || insideWorkTree.stdout.trim() !== "true") {
    const reason = insideWorkTree.stderr.trim().split("\n")[0];
    return refuse(
      `The project root is not a git repository: ${root}${reason ? ` (${reason})` : ""}`,
    );
  }

  const [headCommitResult, headBranchResult, statusResult, logResult, remoteResult, lsFilesResult] =
    await Promise.all([
      runGit(root, ["rev-parse", "HEAD"]),
      runGit(root, ["rev-parse", "--abbrev-ref", "HEAD"]),
      runGit(root, ["status", "--porcelain"]),
      runGit(root, ["log", "-n", "10", "--format=%s"]),
      runGit(root, ["remote", "-v"]),
      runGit(root, ["ls-files", "--", "decisions.md", "**/decisions.md"]),
    ]);

  const headCommit = headCommitResult.exitCode === 0 ? headCommitResult.stdout.trim() : null;
  const headBranch = headBranchResult.exitCode === 0 ? headBranchResult.stdout.trim() : null;
  const dirty = statusResult.stdout.trim().length > 0;
  const recentCommitSubjects =
    logResult.exitCode === 0 ? parseCommitSubjects(logResult.stdout) : [];
  const remotes = parseRemotes(remoteResult.stdout);

  const hasAgentInstructions =
    fileExists(path.join(root, "CLAUDE.md")) || fileExists(path.join(root, "AGENTS.md"));
  const decisionsFolder = findDecisionsFolder(root);
  const hasRulesFolder = directoryExists(path.join(root, ".claude", "rules"));

  const trackedDecisionFiles =
    lsFilesResult.exitCode === 0 ? parseTrackedPaths(lsFilesResult.stdout) : [];
  const decisionFiles = trackedDecisionFiles
    .filter((filePath) => !excludeFolders.some((folder) => isUnderFolder(filePath, folder)))
    .sort();

  return {
    facts: {
      headCommit,
      headBranch,
      remotes,
      dirty,
      recentCommitSubjects,
      hasAgentInstructions,
      decisionsFolder,
      hasRulesFolder,
      decisionFiles,
      adrConvention: detectAdrConvention(root, decisionsFolder),
    },
  };
}

/**
 * The bundle folders a session's last successful export wrote, durable first:
 * what every reader of the project leaves out, so the session never reads its
 * own export back. Empty before the first export.
 */
export function lastExportFolders(session: {
  lastDurableExportFolder: string | null;
  lastWorkingExportFolder: string | null;
}): string[] {
  return [session.lastDurableExportFolder, session.lastWorkingExportFolder].filter(
    (folder): folder is string => folder !== null,
  );
}
