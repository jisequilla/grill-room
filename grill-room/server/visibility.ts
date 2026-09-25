/**
 * Post-export visibility: classifies the files an export bundle wrote (or
 * would write) as tracked, ignored, or untracked in the target repository,
 * and turns that into the plain-language warnings and remedy commands an
 * operator needs.
 *
 * Grill Room never stages or commits in a target repo. Every remedy below is
 * a command for the OPERATOR to run by hand — the app only ever reads.
 *
 * ## Classification
 *
 * {@link classifyVisibility} answers, for each absolute path under a project
 * root, one of:
 *
 * - `tracked` — the path is in the repository's index: `git ls-files`
 *   (given the path as a literal pathspec, so a name that happens to contain
 *   a glob character such as `[` is still matched exactly) lists it.
 * - `ignored` — not tracked, and `git check-ignore` matches it against a
 *   `.gitignore` rule.
 * - `untracked` — neither of the above: a worktree agent starting from
 *   `origin/main` will not see it, and it is not on the ignore list either.
 *
 * Both checks work on a path regardless of whether a file currently sits on
 * disk at it (git matches against its index and ignore rules, not the
 * working tree), so this also serves as a preview before anything is
 * written. Every path is classified with exactly two read-only git calls
 * total, however many paths are given: one batched `ls-files`, one batched
 * `check-ignore` for whatever `ls-files` did not already call tracked.
 *
 * ## Warnings
 *
 * {@link buildVisibilityWarnings} turns a classification into what the UI
 * shows: a plain warning once anything is ignored or untracked, the exact
 * manual command to fix each case, and a separate warning when the project's
 * declared `visibility` flag disagrees with what was just observed.
 */
import path from "node:path";

import type { ProjectVisibility } from "../shared/session-constants.js";
import { checkIgnored } from "./check-ignore.js";
import { runGit } from "./git.js";

export type FileVisibility = "tracked" | "ignored" | "untracked";

export interface ClassifiedFile {
  /** Absolute path, as written (or planned to be written) by the export. */
  path: string;
  /** Relative to the project root, forward slashes — what git was asked about. */
  relativePath: string;
  visibility: FileVisibility;
}

export interface VisibilityWarnings {
  hasUntracked: boolean;
  hasIgnored: boolean;
  /** Plain warning that worktree agents will not see the affected files, or null when nothing is ignored or untracked. */
  warning: string | null;
  /** The commands to add, commit, and push the untracked files, or null when none are untracked. */
  untrackedRemedy: string | null;
  /** Why the ignored files cannot simply be committed, plus a command to see the rule that ignores each one, or null when none are ignored. */
  ignoredRemedy: string | null;
  /** Names both the project's visibility flag and what was observed, or null when they agree. */
  mismatchWarning: string | null;
}

export interface VisibilityReport extends VisibilityWarnings {
  files: ClassifiedFile[];
}

function toRepoRelative(root: string, absolutePath: string): string {
  return path.relative(root, absolutePath).split(path.sep).join("/");
}

/**
 * Classify each of `absolutePaths` (every one inside `root`) as tracked,
 * ignored, or untracked. See the module doc comment for the rules and the
 * call budget.
 */
export async function classifyVisibility(
  root: string,
  absolutePaths: readonly string[],
): Promise<ClassifiedFile[]> {
  if (absolutePaths.length === 0) return [];

  const relativePaths = absolutePaths.map((absolutePath) => toRepoRelative(root, absolutePath));

  // `ls-files` treats its arguments as pathspecs; `:(literal)` keeps a name
  // that happens to contain `*`, `?`, or `[` from being read as a glob.
  const lsFiles = await runGit(root, [
    "ls-files",
    "-z",
    "--",
    ...relativePaths.map((relative) => `:(literal)${relative}`),
  ]);
  const tracked = new Set(lsFiles.stdout.split("\0").filter((entry) => entry.length > 0));

  // `check-ignore` is classified by the shared, position-based helper (see
  // `check-ignore.ts`): every argument prefixed with `./` so a leading `:`
  // is never read as pathspec magic, and a line read off by position rather
  // than by comparing git's echoed pathname against what was sent.
  const remaining = relativePaths.filter((relative) => !tracked.has(relative));
  const ignored = new Set<string>();
  if (remaining.length > 0) {
    const checked = await checkIgnored(root, remaining);
    // A non-0/1 exit or a line count that doesn't match the argument count
    // is a git error; treat it as "none known ignored" rather than fail a
    // whole report over one bad path.
    if (checked.status === "ok") {
      for (const [relative, isIgnored] of checked.ignored) {
        if (isIgnored) ignored.add(relative);
      }
    }
  }

  return absolutePaths.map((absolutePath, index) => {
    const relativePath = relativePaths[index]!;
    const visibility: FileVisibility = tracked.has(relativePath)
      ? "tracked"
      : ignored.has(relativePath)
        ? "ignored"
        : "untracked";
    return { path: absolutePath, relativePath, visibility };
  });
}

/**
 * Turn a classification into the plain warnings and remedy commands the UI
 * shows. `bundleRelativePath` is the bundle directory relative to `root`
 * (forward slashes, no trailing slash) — the path the untracked-file remedy
 * stages as a whole.
 */
export function buildVisibilityWarnings(options: {
  root: string;
  bundleRelativePath: string;
  files: readonly ClassifiedFile[];
  visibility: ProjectVisibility;
}): VisibilityWarnings {
  const { root, bundleRelativePath, files, visibility } = options;
  const untrackedFiles = files.filter((file) => file.visibility === "untracked");
  const ignoredFiles = files.filter((file) => file.visibility === "ignored");
  const hasUntracked = untrackedFiles.length > 0;
  const hasIgnored = ignoredFiles.length > 0;

  const warning =
    hasUntracked || hasIgnored
      ? "Worktree agents start from origin/main and will not see a file this repository does not track. " +
        "Grill Room never stages or commits here — use the command below to fix it yourself."
      : null;

  const untrackedRemedy = hasUntracked
    ? [
        `git -C ${root} add ${bundleRelativePath}`,
        `git -C ${root} commit -m "Add exported session bundle"`,
        `git -C ${root} push`,
      ].join("\n")
    : null;

  const ignoredRemedy = hasIgnored
    ? [
        "These files are ignored by this repository and cannot be committed without changing that rule. " +
          "Agents will need absolute paths into this checkout instead.",
        ...ignoredFiles.map((file) => `git -C ${root} check-ignore -v ${file.relativePath}`),
      ].join("\n")
    : null;

  let mismatchWarning: string | null = null;
  if (visibility === "tracked" && hasIgnored) {
    mismatchWarning =
      `This project's visibility flag says "tracked", but the exported files are ignored by this ` +
      `repository. Update the flag in project settings, or fix .gitignore.`;
  } else if (visibility === "ignored" && !hasIgnored) {
    mismatchWarning =
      `This project's visibility flag says "ignored", but none of the exported files are actually ` +
      `ignored by this repository. Update the flag in project settings.`;
  }

  return { hasUntracked, hasIgnored, warning, untrackedRemedy, ignoredRemedy, mismatchWarning };
}

/**
 * Classify `absolutePaths` and build their warnings in one call — what
 * `export-session` and `get-export-visibility` both return.
 */
export async function buildVisibilityReport(options: {
  root: string;
  bundleDir: string;
  absolutePaths: readonly string[];
  visibility: ProjectVisibility;
}): Promise<VisibilityReport> {
  const files = await classifyVisibility(options.root, options.absolutePaths);
  const bundleRelativePath = toRepoRelative(options.root, options.bundleDir);
  const warnings = buildVisibilityWarnings({
    root: options.root,
    bundleRelativePath,
    files,
    visibility: options.visibility,
  });
  return { files, ...warnings };
}
