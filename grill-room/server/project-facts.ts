/**
 * The deterministic half of project grounding: facts about a registered
 * project's repository that the server can know for certain, collected with
 * the existing read-only git helper (`server/git.ts`) and plain file checks.
 * No model ever derives them.
 *
 * See `.scratch/project-scout/spec.md` ("Server facts") and
 * `.scratch/project-scout/issues/01-server-facts.md`.
 */
import { statSync } from "node:fs";
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
   * so is one under the folder passed as `excludeFolder`. The scout prompt
   * lists these as recorded decision sources.
   */
  decisionFiles: string[];
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
function isUnderFolder(filePath: string, folder: string): boolean {
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
 * `excludeFolder`, when given, is a project-relative folder whose
 * `decisions.md` files are left out of `decisionFiles`.
 */
export async function collectProjectFacts(
  root: string,
  excludeFolder?: string,
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
    .filter((filePath) => excludeFolder === undefined || !isUnderFolder(filePath, excludeFolder))
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
    },
  };
}
