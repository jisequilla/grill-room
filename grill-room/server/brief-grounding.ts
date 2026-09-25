/**
 * The brief grounding: what a handoff scout found reading a session's project
 * for every ticket of its handoff, stored beside the handoff with the HEAD
 * commit it read and the handoff fingerprint it was made for.
 *
 * A grounding is current only while both still match: the handoff's
 * fingerprint over today's inputs, and the project's HEAD. Staleness is
 * computed here on every read and never stored, the same way the scout
 * report's is (`server/scout-report.ts`).
 *
 * The rejection check runs on top of the result schema: every citation passes
 * the project scout's `checkCitation`, and the tickets, their dependencies and
 * the files they plan are checked against the handoff and the working tree.
 *
 * See `.scratch/handoff-scout/spec.md` ("The rejection check", "Storage").
 */
import { randomUUID } from "node:crypto";
import { lstatSync, realpathSync, statSync } from "node:fs";
import path from "node:path";

import { eq } from "@agent-native/core/db/schema";

import { getDb, schema } from "./db/index.js";
import { runGit } from "./git.js";
import {
  getHandoffRow,
  handoffFingerprint,
  loadHandoffSource,
} from "./handoff.js";
import {
  handoffScoutResultSchema,
  type HandoffScoutResult,
  type InterviewerModel,
} from "./interviewer/index.js";
import { checkCitation } from "./scout-report.js";

/** A stored brief grounding, as every reader sees it. */
export interface BriefGrounding {
  id: string;
  sessionId: string;
  result: HandoffScoutResult;
  /** The HEAD commit it read, or null for a repository with no commits yet. */
  commitRead: string | null;
  /** The handoff fingerprint it was made for. */
  handoffFingerprint: string;
  model: InterviewerModel;
  ranAt: string;
  /** The turn record that produced it. */
  turnId: string | null;
}

/** Why a grounding no longer describes the session's handoff and project. */
export type BriefGroundingStaleReason = "head-moved" | "handoff-changed";

/** A grounding with whether it still describes the handoff and the project. */
export interface BriefGroundingWithStaleness extends BriefGrounding {
  current: boolean;
  /** Null while current. */
  staleReason: BriefGroundingStaleReason | null;
}

type BriefGroundingRow = typeof schema.briefGroundings.$inferSelect;

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/** A stored row as a grounding, or null when what is stored cannot be read. */
function readRow(row: BriefGroundingRow): BriefGrounding | null {
  const result = handoffScoutResultSchema.safeParse(parseJson(row.resultJson));
  if (!result.success) return null;
  return {
    id: row.id,
    sessionId: row.sessionId,
    result: result.data,
    commitRead: row.commitRead,
    handoffFingerprint: row.handoffFingerprint,
    model: row.model as InterviewerModel,
    ranAt: row.ranAt,
    turnId: row.turnId,
  };
}

/** The session's grounding, stale or not, or null when it has none. */
export async function latestBriefGrounding(
  sessionId: string,
): Promise<BriefGrounding | null> {
  const [row] = await getDb()
    .select()
    .from(schema.briefGroundings)
    .where(eq(schema.briefGroundings.sessionId, sessionId))
    .limit(1);
  return row ? readRow(row) : null;
}

/**
 * Store an accepted grounding as the session's, replacing any it had. The
 * old row is removed and the new one written in one transaction, so a failed
 * write keeps the previous grounding.
 */
export async function storeBriefGrounding(input: {
  sessionId: string;
  result: HandoffScoutResult;
  commitRead: string | null;
  handoffFingerprint: string;
  model: InterviewerModel;
  turnId: string | null;
  ranAt: string;
}): Promise<BriefGrounding> {
  const grounding: BriefGrounding = { id: randomUUID(), ...input };
  await getDb().transaction(async (tx) => {
    await tx
      .delete(schema.briefGroundings)
      .where(eq(schema.briefGroundings.sessionId, input.sessionId));
    await tx.insert(schema.briefGroundings).values({
      id: grounding.id,
      sessionId: grounding.sessionId,
      resultJson: JSON.stringify(grounding.result),
      commitRead: grounding.commitRead,
      handoffFingerprint: grounding.handoffFingerprint,
      model: grounding.model,
      ranAt: grounding.ranAt,
      turnId: grounding.turnId,
    });
  });
  return grounding;
}

/**
 * The project's HEAD commit now: a hash, null for a repository with no commits
 * yet, or undefined when the root is no longer a git repository at all.
 */
async function currentHead(root: string): Promise<string | null | undefined> {
  const inside = await runGit(root, ["rev-parse", "--is-inside-work-tree"]);
  if (inside.exitCode !== 0 || inside.stdout.trim() !== "true") return undefined;
  const head = await runGit(root, ["rev-parse", "HEAD"]);
  return head.exitCode === 0 ? head.stdout.trim() : null;
}

/**
 * Why a grounding no longer describes the session, or null while it does.
 *
 * `handoff-changed` when the handoff was regenerated or removed, or today's
 * inputs no longer hash to the fingerprint the grounding was made for — a
 * ticket edit, a regeneration, a project edit. `head-moved` when the
 * project's HEAD is no longer the commit it read, or the project is no longer
 * a repository. The handoff is checked first: a handoff that changed makes
 * the grounding describe the wrong tickets, whatever the commit.
 */
export async function briefGroundingStaleReason(
  grounding: BriefGrounding,
): Promise<BriefGroundingStaleReason | null> {
  const row = await getHandoffRow(grounding.sessionId);
  const loaded = await loadHandoffSource(grounding.sessionId);
  const fingerprint =
    "source" in loaded ? handoffFingerprint(loaded.source) : null;
  if (
    !row ||
    row.fingerprint !== grounding.handoffFingerprint ||
    fingerprint !== grounding.handoffFingerprint
  ) {
    return "handoff-changed";
  }

  // The fingerprint covers the project's root, so a current handoff's source
  // names the same project the grounding read.
  if (!("source" in loaded)) return "handoff-changed";
  const head = await currentHead(loaded.source.project.rootPath);
  if (head === undefined || head !== grounding.commitRead) return "head-moved";
  return null;
}

/** The session's grounding with its staleness, or null when it has none. */
export async function currentBriefGrounding(
  sessionId: string,
): Promise<BriefGroundingWithStaleness | null> {
  const grounding = await latestBriefGrounding(sessionId);
  if (!grounding) return null;
  const staleReason = await briefGroundingStaleReason(grounding);
  return { ...grounding, current: staleReason === null, staleReason };
}

/** One ticket of the handoff, as the rejection check needs it. */
export interface GroundedHandoffTicket {
  number: number;
  blockedBy: readonly number[];
}

function isInside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return (
    relative === "" ||
    (relative !== ".." &&
      !relative.startsWith(`..${path.sep}`) &&
      !path.isAbsolute(relative))
  );
}

function samePath(a: string, b: string): boolean {
  return path.posix.normalize(a) === path.posix.normalize(b);
}

function exists(candidate: string): boolean {
  try {
    lstatSync(candidate);
    return true;
  } catch {
    return false;
  }
}

/**
 * Whether `candidate` (inside `realRoot` lexically) still lands inside it
 * once symlinks are followed: the candidate itself when it exists, otherwise
 * its deepest existing ancestor.
 */
function resolvesInside(realRoot: string, candidate: string): boolean {
  let probe = candidate;
  for (;;) {
    try {
      return isInside(realRoot, realpathSync(probe));
    } catch {
      const parent = path.dirname(probe);
      if (parent === probe) return false;
      probe = parent;
    }
  }
}

/** Whether a path has a `.git` segment: git's own folder, which it never tracks. */
function isInsideGitDir(candidate: string): boolean {
  return candidate
    .split(/[\\/]/)
    .some((segment) => segment.toLowerCase() === ".git");
}

const C_ESCAPES: Record<string, number> = {
  a: 0x07,
  b: 0x08,
  t: 0x09,
  n: 0x0a,
  v: 0x0b,
  f: 0x0c,
  r: 0x0d,
  '"': 0x22,
  "\\": 0x5c,
};

/**
 * One path as git prints it, unquoted. git wraps a path holding a non-ASCII
 * byte, a quote, a backslash or a control character in double quotes, with C
 * escapes and octal bytes (`"dist/\303\251.js"`); any other path is printed
 * as it is. With `core.quotePath=false`, a non-ASCII byte alone no longer
 * triggers quoting, but a quote, backslash or control character still does,
 * with every other character — including a multi-byte one like an emoji —
 * printed raw inside the quotes rather than octal-escaped.
 *
 * Walked one Unicode code point at a time (`Array.from`, not `body[index]`):
 * a UTF-16 index would split a surrogate pair in two, and encoding each half
 * on its own garbles it, since neither half is valid UTF-8 by itself. The
 * escape sequences this loop looks ahead for (`\t`, `\NNN`, ...) are always
 * plain ASCII, so they are unaffected — each is one element of the code-point
 * array too.
 *
 * `-z` would print every path raw, but `git check-ignore` accepts `-z` only
 * with `--stdin` ("fatal: -z only makes sense with --stdin"), and the
 * read-only wrapper gives git no stdin.
 */
export function unquoteGitPath(printed: string): string {
  if (printed.length < 2 || !printed.startsWith('"') || !printed.endsWith('"')) {
    return printed;
  }
  const chars = Array.from(printed.slice(1, -1));
  const bytes: number[] = [];
  for (let index = 0; index < chars.length; index += 1) {
    const char = chars[index]!;
    if (char !== "\\") {
      bytes.push(...Buffer.from(char, "utf8"));
      continue;
    }
    const octal = /^[0-3][0-7]{2}/.exec(chars.slice(index + 1, index + 4).join(""));
    const next = chars[index + 1] ?? "";
    if (octal) {
      bytes.push(parseInt(octal[0], 8));
      index += 3;
    } else if (next in C_ESCAPES) {
      bytes.push(C_ESCAPES[next]!);
      index += 1;
    } else {
      bytes.push(0x5c);
    }
  }
  return Buffer.from(bytes).toString("utf8");
}

function listNumbers(numbers: readonly number[]): string {
  return numbers.length === 0 ? "none" : numbers.join(", ");
}

/**
 * Why a handoff scout result cannot be stored, written for the scout. Empty
 * when it can:
 *
 * - every citation (`buildsOnFiles`, `facts`, a citation-form `buildsOn`)
 *   points at real lines of the project;
 * - every ticket of the handoff appears exactly once, and no other does;
 * - every blocker of a ticket has exactly one `buildsOn` entry, and every
 *   `buildsOn` names a real blocker;
 * - no file to change has a `.git` segment;
 * - a file marked `edit` exists;
 * - a file marked `create` resolves inside the root, does not exist, and is
 *   not ignored by git;
 * - a `buildsOn` on a path to be created names a path that blocker lists as
 *   a `create`.
 *
 * Async because the ignore check runs `git check-ignore` through the
 * read-only wrapper, once for every `create` path together.
 */
export async function reasonsToRefuseHandoffGrounding(
  result: HandoffScoutResult,
  input: { projectRoot: string; tickets: readonly GroundedHandoffTicket[] },
): Promise<string[]> {
  const reasons: string[] = [];

  const citations = result.tickets.flatMap((ticket) => [
    ...ticket.buildsOnFiles,
    ...ticket.facts.map((fact) => fact.citation),
    ...ticket.buildsOn.flatMap((entry) =>
      entry.citation === null ? [] : [entry.citation],
    ),
  ]);
  for (const citation of new Set(citations)) {
    const problem = checkCitation(input.projectRoot, citation);
    if (problem) reasons.push(problem);
  }

  const handoffNumbers = input.tickets.map((ticket) => ticket.number);
  const blockersOf = new Map(
    input.tickets.map((ticket) => [ticket.number, new Set(ticket.blockedBy)]),
  );
  const timesReported = new Map<number, number>();
  for (const ticket of result.tickets) {
    timesReported.set(ticket.number, (timesReported.get(ticket.number) ?? 0) + 1);
  }
  for (const number of handoffNumbers) {
    const times = timesReported.get(number) ?? 0;
    if (times === 0) {
      reasons.push(
        `Ticket ${number} is missing; report every ticket of the handoff (${listNumbers(handoffNumbers)}) exactly once.`,
      );
    } else if (times > 1) {
      reasons.push(
        `Ticket ${number} appears ${times} times; report each ticket exactly once.`,
      );
    }
  }
  for (const number of timesReported.keys()) {
    if (!blockersOf.has(number)) {
      reasons.push(
        `Ticket ${number} is not a ticket of this handoff; report only tickets ${listNumbers(handoffNumbers)}.`,
      );
    }
  }

  const createsOf = new Map<number, string[]>();
  for (const ticket of result.tickets) {
    createsOf.set(ticket.number, [
      ...(createsOf.get(ticket.number) ?? []),
      ...ticket.filesToChange
        .filter((file) => file.change === "create")
        .map((file) => file.path),
    ]);
  }

  for (const ticket of result.tickets) {
    const blockers = blockersOf.get(ticket.number);
    if (!blockers) continue;
    for (const blocker of [...blockers].sort((a, b) => a - b)) {
      const entries = ticket.buildsOn.filter((entry) => entry.blocker === blocker).length;
      if (entries === 0) {
        reasons.push(
          `Ticket ${ticket.number} is blocked by ticket ${blocker}, but its buildsOn has no entry for ticket ${blocker}; give one buildsOn entry per blocker, naming what this ticket needs from it and the check that proves it.`,
        );
      } else if (entries > 1) {
        reasons.push(
          `Ticket ${ticket.number}'s buildsOn names ticket ${blocker} ${entries} times; give exactly one buildsOn entry per blocker.`,
        );
      }
    }
    for (const entry of ticket.buildsOn) {
      if (!blockers.has(entry.blocker)) {
        reasons.push(
          `Ticket ${ticket.number}'s buildsOn names ticket ${entry.blocker}, which does not block it; ticket ${ticket.number} is blocked by ${listNumbers([...blockers].sort((a, b) => a - b))}. Give one buildsOn entry per real blocker.`,
        );
        continue;
      }
      if (entry.createdPath !== null) {
        const created = createsOf.get(entry.blocker) ?? [];
        if (!created.some((planned) => samePath(planned, entry.createdPath!))) {
          reasons.push(
            `Ticket ${ticket.number}'s buildsOn on ticket ${entry.blocker} depends on ${entry.createdPath}, which ticket ${entry.blocker} does not list as a create in its filesToChange; depend on a path ticket ${entry.blocker} creates, or cite existing code.`,
          );
        }
      }
    }
  }

  let realRoot: string;
  try {
    realRoot = realpathSync(input.projectRoot);
  } catch {
    reasons.push(
      `The planned files cannot be checked: the project root ${input.projectRoot} does not exist.`,
    );
    return reasons;
  }

  const toCheckIgnored: { ticket: number; path: string }[] = [];
  for (const ticket of result.tickets) {
    for (const file of ticket.filesToChange) {
      if (isInsideGitDir(file.path)) {
        reasons.push(
          `Ticket ${ticket.number} marks ${file.path} as ${file.change}, but it is inside a .git folder, which the repository never tracks; plan files outside .git.`,
        );
        continue;
      }
      const resolved = path.resolve(realRoot, file.path);
      const inside =
        !path.isAbsolute(file.path) &&
        isInside(realRoot, resolved) &&
        resolvesInside(realRoot, resolved);

      if (file.change === "edit") {
        let isFile = false;
        try {
          isFile = inside && statSync(realpathSync(resolved)).isFile();
        } catch {
          isFile = false;
        }
        if (!inside) {
          reasons.push(
            `Ticket ${ticket.number} marks ${file.path} as edit, but it resolves outside the project; edit files inside the project.`,
          );
        } else if (!isFile) {
          reasons.push(
            `Ticket ${ticket.number} marks ${file.path} as edit, but no such file exists in the project; mark it create, or name a file that exists.`,
          );
        }
        continue;
      }

      if (!inside) {
        reasons.push(
          `Ticket ${ticket.number} marks ${file.path} as create, but it resolves outside the project; create files inside the project.`,
        );
      } else if (exists(resolved)) {
        reasons.push(
          `Ticket ${ticket.number} marks ${file.path} as create, but it already exists; mark it edit, or name a new path.`,
        );
      } else {
        toCheckIgnored.push({
          ticket: ticket.number,
          path: path.relative(realRoot, resolved).split(path.sep).join("/"),
        });
      }
    }
  }

  if (toCheckIgnored.length > 0) {
    const unique = [...new Set(toCheckIgnored.map((entry) => entry.path))];
    // A path starting with `:` is git pathspec magic (`:/` is "top", `:(word)`
    // is the long form); an untrusted, model-supplied path can start with it
    // by chance. `check-ignore` refuses `--literal-pathspecs` outright ("git
    // check-ignore" section of `git.ts`'s `RunGitOptions`), so the magic is
    // neutralized here instead: `./` in front of a pathspec makes it start
    // with `.` rather than `:`, which git never treats as magic, and is a
    // no-op for every path that did not start with `:` to begin with — an
    // ordinary path still matches the same ignore rules through it. Stripped
    // back off below, since `check-ignore` echoes the argument it matched.
    const checked = await runGit(realRoot, [
      "check-ignore",
      "--",
      ...unique.map((entry) => `./${entry}`),
    ]);
    if (checked.exitCode === 0 || checked.exitCode === 1) {
      const ignored = new Set(
        checked.stdout
          .split("\n")
          .filter(Boolean)
          .map(unquoteGitPath)
          .map((entry) => (entry.startsWith("./") ? entry.slice(2) : entry)),
      );
      for (const entry of toCheckIgnored) {
        if (ignored.has(entry.path)) {
          reasons.push(
            `Ticket ${entry.ticket} marks ${entry.path} as create, but git ignores that path, so the repository would never track it; plan a path git tracks.`,
          );
        }
      }
    } else {
      reasons.push(
        `The files marked create could not be checked against the project's ignore rules (git check-ignore exited ${checked.exitCode}); plan ordinary paths inside the project.`,
      );
    }
  }

  return reasons;
}
