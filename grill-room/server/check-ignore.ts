/**
 * Shared, position-based `git check-ignore` classification.
 *
 * `git check-ignore -v -n` prints exactly one line per argument, in the
 * order given: `<source>:<line>:<pattern>` then a tab then the pathname for
 * a match — including one decided by a negation (`!pattern`), which does
 * NOT mean ignored, see {@link excludesPath} — or `::` then a tab then the
 * pathname for a miss. Matched/not-matched is read off by POSITION, never by
 * comparing that trailing pathname against what was sent: git is free to
 * rewrite it (Unicode-normalize under `core.precomposeUnicode`, re-encode a
 * lone surrogate its own way, quote-and-escape it) in ways that no longer
 * equal the input string, so a text comparison can miss an ignored path
 * silently.
 *
 * Every argument is prefixed with `./` so a path starting with `:` is never
 * read as git pathspec magic (`:/` is "top", `:(word)` the long form) — an
 * untrusted, caller-supplied path can start with `:` by chance. This is a
 * no-op for a path that did not start with `:` to begin with, and still
 * matches the same ignore rules through the prefix.
 */
import { runGit } from "./git.js";

export type CheckIgnoreResult =
  | { status: "ok"; ignored: Map<string, boolean> }
  | { status: "exit-error"; exitCode: number }
  | { status: "count-mismatch"; lineCount: number; pathCount: number };

/**
 * Whether one line of `git check-ignore -v -n` output — everything before
 * its trailing tab and pathname — means the path is genuinely excluded.
 *
 * `::` alone is the miss marker: no rule matched. Anything else is
 * `<source>:<line>:<pattern>`, and the path counts as ignored only when
 * `pattern` does not start with `!` — a negation re-includes a path an
 * earlier, broader pattern excluded (`*.log` + `!important.log`), and `-v`
 * reports that negating rule as the match, not a miss.
 *
 * `source` names a file (`.gitignore`, `.git/info/exclude`, ...) and can
 * itself contain colons, so the split point is found from `line` — always a
 * run of digits — rather than by counting colons from the left. A field
 * that doesn't fit this shape at all (a future git version's format
 * changing under us) is treated as an ordinary, non-negating match rather
 * than silently letting an unrecognized line make an ignored path look
 * safe.
 */
export function excludesPath(field: string): boolean {
  if (field === "::") return false;
  const pattern = /^.*?:\d+:(.*)$/.exec(field);
  return pattern === null || !pattern[1]!.startsWith("!");
}

/**
 * Classify each of `paths` (relative to `root`, forward slashes) as ignored
 * or not, with one batched `git check-ignore -v -n` call.
 *
 * `status: "ok"` gives one entry per path in `ignored`, keyed by the exact
 * string passed in. The other statuses mean the call could not be trusted
 * at all — a non-0/1 exit, or a line count that doesn't match the argument
 * count (a git version that batches or reorders output differently) — and
 * it is left to the caller to decide how to fail: refuse outright, or treat
 * every path as not (yet) known ignored.
 */
export async function checkIgnored(
  root: string,
  paths: readonly string[],
): Promise<CheckIgnoreResult> {
  if (paths.length === 0) return { status: "ok", ignored: new Map() };

  const checked = await runGit(root, [
    "check-ignore",
    "-v",
    "-n",
    "--",
    ...paths.map((entry) => `./${entry}`),
  ]);
  const lines = checked.stdout.split("\n").filter(Boolean);

  if (checked.exitCode !== 0 && checked.exitCode !== 1) {
    return { status: "exit-error", exitCode: checked.exitCode };
  }
  if (lines.length !== paths.length) {
    return { status: "count-mismatch", lineCount: lines.length, pathCount: paths.length };
  }

  const ignored = new Map<string, boolean>();
  paths.forEach((entry, index) => {
    const line = lines[index]!;
    const tab = line.indexOf("\t");
    const field = tab === -1 ? line : line.slice(0, tab);
    ignored.set(entry, excludesPath(field));
  });
  return { status: "ok", ignored };
}
