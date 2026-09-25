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

import { checkIgnored } from "./check-ignore.js";
import { getDb, schema } from "./db/index.js";
import { runGit } from "./git.js";
import {
  blockerThatCreates,
  getHandoffRow,
  handoffFingerprint,
  loadHandoffSource,
  transitiveBlockers,
} from "./handoff.js";
import {
  handoffScoutResultSchema,
  staysInsideRepo,
  type HandoffScoutResult,
  type InterviewerModel,
} from "./interviewer/index.js";
import { checkCitation } from "./scout-report.js";
import { computeWaves } from "./tickets.js";

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

function listNumbers(numbers: readonly number[]): string {
  return numbers.length === 0 ? "none" : numbers.join(", ");
}

/** The tickets of `result` that mark `filePath` as a create. */
function creatorsOf(result: HandoffScoutResult, filePath: string): number[] {
  return [
    ...new Set(
      result.tickets
        .filter((ticket) =>
          ticket.filesToChange.some(
            (file) => file.change === "create" && samePath(file.path, filePath),
          ),
        )
        .map((ticket) => ticket.number),
    ),
  ];
}

/**
 * Why an `edit` of a file that is not on disk is refused: none of the
 * ticket's blockers creates it. When a ticket that does not block it creates
 * it, the reason says so, since that is the edge the scout cannot add.
 */
function missingEditReason(
  ticketNumber: number,
  filePath: string,
  result: HandoffScoutResult,
): string {
  const base = `Ticket ${ticketNumber} marks ${filePath} as edit, but no such file exists in the project and none of its blockers creates it; mark it create, name a file that exists, or edit a file one of its blockers (directly or through their own blockers) marks as create.`;
  const creators = creatorsOf(result, filePath).filter((number) => number !== ticketNumber);
  if (creators.length === 0) return base;
  const named = creators.map((number) => `ticket ${number}`).join(" and ");
  const verb = creators.length === 1 ? "creates" : "create";
  return `${base} ${named[0]!.toUpperCase()}${named.slice(1)} ${verb} it but does not block ticket ${ticketNumber}, so ticket ${ticketNumber} cannot edit it; create a file of its own instead.`;
}

/**
 * Why a path marked `create` by more than one ticket is refused: only one
 * ticket may create a path. The first creator keeps it: the one in the
 * earliest wave of the Blocked-by graph, and the lowest number within a wave.
 * A later creator that the first one blocks, directly or transitively, is
 * told to mark it `edit`; one it does not block is told to drop the file or
 * create a file of its own beside it, since it may not edit it.
 *
 * Paths collide as a case-insensitive file system would see them: compared
 * NFC-normalised, case-folded, with trailing slashes stripped, so
 * `Export_test.go` and `export_test.go` are one path. Tickets the handoff
 * does not have are left to the missing-ticket reasons.
 */
function doubleCreateReasons(
  result: HandoffScoutResult,
  tickets: readonly GroundedHandoffTicket[],
): string[] {
  const inHandoff = new Set(tickets.map((ticket) => ticket.number));
  const computed = computeWaves(tickets);
  const waveOf = new Map<number, number>();
  if (computed.ok) {
    computed.waves.forEach((wave, index) => {
      for (const number of wave) waveOf.set(number, index + 1);
    });
  }
  const order = (a: number, b: number) =>
    (waveOf.get(a) ?? 1) - (waveOf.get(b) ?? 1) || a - b;

  /** Per colliding path: each creating ticket, with the spelling it used. */
  const creators = new Map<string, { spellings: Map<number, string> }>();
  for (const ticket of result.tickets) {
    if (!inHandoff.has(ticket.number)) continue;
    for (const file of ticket.filesToChange) {
      if (file.change !== "create") continue;
      const key = collisionKey(file.path);
      const entry = creators.get(key) ?? { spellings: new Map<number, string>() };
      if (!entry.spellings.has(ticket.number)) entry.spellings.set(ticket.number, file.path);
      creators.set(key, entry);
    }
  }

  const reasons: string[] = [];
  for (const file of creators.values()) {
    const [first, ...later] = [...file.spellings.keys()].sort(order);
    const kept = file.spellings.get(first!)!;
    for (const number of later) {
      const spelling = file.spellings.get(number)!;
      const named =
        spelling === kept
          ? kept
          : `${kept} (as ${spelling} in ticket ${number}, the same path on a case-insensitive file system)`;
      const both = `Tickets ${first} and ${number} both mark ${named} as create; only one ticket may create a path. Ticket ${first} comes first (an earlier wave of the Blocked-by graph, or the lower number within a wave), so it keeps the create.`;
      reasons.push(
        transitiveBlockers(number, tickets).includes(first!)
          ? `${both} Ticket ${number} is blocked by ticket ${first}, so mark ${kept} as edit in ticket ${number}: a ticket may edit a file one of its blockers creates.`
          : `${both} Ticket ${number} may mark it edit only when it is blocked by ticket ${first}, directly or through its blockers, and it is not; drop it from ticket ${number}'s filesToChange, or have ticket ${number} create a file of its own beside it.`,
      );
    }
  }
  return reasons;
}

/**
 * How a file is recognised as a test by its name alone, the common naming of
 * the languages the app grounds. A path is a test when its extension is a
 * source-code one ({@link SOURCE_FILE_EXTENSION}) and it matches one of:
 *
 * - `_test.*` or `_spec.*` at the end of the name: Go's `_test.go`, Python's
 *   `*_test.py`, Elixir's `_test.exs`, RSpec's `_spec.rb`;
 * - `.test.*` or `.spec.*`: JavaScript and TypeScript;
 * - a name starting `test_`: Python's `test_*.py`;
 * - a folder named `__tests__`, `test`, `tests`, `Test`, `Tests` or `spec`,
 *   or ending `.Tests` (.NET's `MyApp.Tests/`), anywhere in the path.
 *
 * Matched against the path relative to the project root, with `/`
 * separators. Requiring a source extension keeps configuration out:
 * `docker-compose.test.yml` and `src/test/resources/application.yml` are not
 * tests. The proof check uses it to tell a test a ticket extends from a file
 * it changes. It does not try to recognise generated files, or tests inline
 * in a source file such as Rust's.
 */
export const TEST_FILE_PATTERNS: readonly RegExp[] = [
  /_(?:test|spec)\.[^/]+$/,
  /\.(?:test|spec)\.[^/]+$/,
  /(?:^|\/)test_[^/]+$/,
  /(?:^|\/)(?:__tests__|[Tt]ests?|spec)\//,
  /(?:^|\/)[^/]+\.Tests\//,
];

/** The source-code extensions a test file by {@link TEST_FILE_PATTERNS} must end in. */
export const SOURCE_FILE_EXTENSION =
  /\.(?:go|[cm]?[jt]sx?|py|rb|exs?|rs|java|kts?|scala|groovy|swift|cs|fs|vb|php|c|cc|cpp|cxx|h|hpp|m|mm|dart|clj|lua|sh|vue|svelte)$/;

/** Whether a path is a test file by {@link TEST_FILE_PATTERNS} and {@link SOURCE_FILE_EXTENSION}. */
export function isTestFileByName(filePath: string): boolean {
  const normalized = path.posix.normalize(filePath.replace(/\\/g, "/"));
  return (
    SOURCE_FILE_EXTENSION.test(normalized) &&
    TEST_FILE_PATTERNS.some((pattern) => pattern.test(normalized))
  );
}

/**
 * Why a ticket's proof is refused because its `testPath` is a file the same
 * ticket marks `edit` and that is not a test by name: the file the ticket
 * changes cannot prove the change. A test path the ticket creates is always
 * accepted, as is an edited test file, and a null `testPath` (a ticket the
 * spec keeps untested, proved by its command alone) is not checked.
 */
function editedProofReason(ticket: HandoffScoutResult["tickets"][number]): string | null {
  const { testPath } = ticket.provedBy;
  if (testPath === null) return null;
  const edited = ticket.filesToChange.some(
    (file) => file.change === "edit" && samePath(file.path, testPath),
  );
  if (!edited || isTestFileByName(testPath)) return null;
  return `Ticket ${ticket.number} is proved by ${testPath}, a file it edits that is not a test by its name (a source file named *_test.*, *_spec.*, *.test.*, *.spec.* or test_*, or one under a __tests__/, test/, tests/, Tests/, *.Tests/ or spec/ folder), so it would pass before the change as well as after. The proof must be a test, or a command that fails on the current commit (a build, or a grep for what the ticket adds), with a test path the ticket creates or edits; when the spec rules out tests for this kind of change, set testPath to null and give that command alone.`;
}

/**
 * The directory a command starts by changing into, normalised (no leading
 * `./`, no trailing `/`), and the rest of the command after `cd <dir> &&` or
 * `cd <dir>;`. Null when it does not start that way, or changes into the
 * root itself, an absolute path or a parent folder.
 */
function leadingCd(command: string): { dir: string; rest: string } | null {
  const match = /^\s*cd\s+(["']?)([^\s"';&|]+)\1\s*(?:&&|;)(.*)$/s.exec(command);
  if (!match) return null;
  let dir = match[2]!;
  while (dir.startsWith("./")) dir = dir.slice(2);
  dir = dir.replace(/\/+$/, "");
  if (dir === "" || dir === "." || dir.startsWith("/") || dir.startsWith("~") || dir.split("/").includes("..")) {
    return null;
  }
  return { dir, rest: match[3]! };
}

/**
 * The first word of `command` that names a path from the repository root
 * although the command has changed into a folder first: it starts with
 * `cd <dir> &&` (or `;`), a later word begins with `<dir>/`, which then
 * resolves to `<dir>/<dir>/…`, and `<projectRoot>/<dir>/<dir>` does not
 * exist. A project that really nests a folder of the same name, such as
 * Django's `mysite/mysite/`, is left alone. Quotes and a `./` in front of the
 * word are ignored; a word that merely contains `<dir>/` further in, such as
 * `b/<dir>/x`, is not a match. Words after a second `cd` are not looked at,
 * since that one moves the directory again. Null when there is none.
 */
function pathIgnoringCd(
  command: string,
  projectRoot: string,
): { dir: string; word: string } | null {
  const cd = leadingCd(command);
  if (!cd) return null;
  if (exists(path.join(projectRoot, cd.dir, cd.dir))) return null;
  const prefix = `${cd.dir}/`;
  for (const segment of cd.rest.split(/&&|\|\||;|\|/)) {
    const words = segment.trim().split(/\s+/).filter((word) => word !== "");
    if (words[0] === "cd") break;
    for (const raw of words) {
      let word = raw.replace(/^["'(]+/, "").replace(/["')]+$/, "");
      while (word.startsWith("./")) word = word.slice(2);
      if (word.startsWith(prefix)) return { dir: cd.dir, word };
    }
  }
  return null;
}

/** The refusal reason for a command whose path ignores its own `cd`, or null. */
function cdReason(command: string, runs: string, projectRoot: string): string | null {
  const found = pathIgnoringCd(command, projectRoot);
  if (!found) return null;
  const { dir, word } = found;
  const relative = word.slice(dir.length + 1);
  const suggestion = relative === "" ? ". (the folder the cd moved into)" : relative;
  return `${runs} runs \`cd ${dir}\` and then names ${word}; after \`cd ${dir}\`, paths are relative to ${dir}, so it would look for ${dir}/${word}. Write it as ${suggestion}, or run the command from the repository root without the cd.`;
}

/** A path as a case-insensitive, normalising file system such as APFS compares it. */
function collisionKey(filePath: string): string {
  return path.posix
    .normalize(filePath.normalize("NFC"))
    .toLowerCase()
    .replace(/\/+$/, "");
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
 * - every `buildsOn` sets exactly one of `citation`, `createdPath` and
 *   `editedPath`, and `symbol` exactly when it sets `editedPath`;
 * - every path (a file to change, `createdPath`, `editedPath`, the proving
 *   test) is relative to the root and stays inside it;
 * - no file to change has a `.git` segment;
 * - a file marked `edit` exists, or is a `create` of one of the ticket's
 *   blockers, directly or through their own blockers;
 * - a file marked `create` resolves inside the root, does not exist, and is
 *   not ignored by git;
 * - no path is marked `create` by more than one ticket (compared as a
 *   case-insensitive file system would): the first creator (earliest wave,
 *   then lowest number) keeps it; a later one the first creator blocks is
 *   told to mark it `edit`, and any other later one to drop it or create a
 *   file of its own beside it;
 * - a `buildsOn` on a path to be created names a path that blocker lists as
 *   a `create`, and one on a path it edits names a path that blocker lists as
 *   an `edit`;
 * - a ticket that changes files lists its proving test among them, unless
 *   its `testPath` is null (the spec rules out tests for its kind of change,
 *   and the command alone proves it);
 * - a proving test the ticket marks `edit` is a test by its name
 *   ({@link isTestFileByName}), not the file the ticket changes; one it
 *   creates is always accepted;
 * - a `buildsOn` check or a `provedBy` command that starts `cd <dir> &&` (or
 *   `cd <dir>;`) names no later path beginning with `<dir>/` while the
 *   project has no `<dir>/<dir>`, since after the `cd` paths are relative to
 *   `<dir>`.
 *
 * These are the rules the result schema leaves to the app: breaking one is a
 * refusal the scout retries, where a schema failure would end the turn.
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

  for (const ticket of result.tickets) {
    const paths = [
      ...ticket.filesToChange.map((file) => ({ field: "filesToChange", path: file.path })),
      ...ticket.buildsOn.flatMap((entry) => [
        ...(entry.createdPath === null ? [] : [{ field: "createdPath", path: entry.createdPath }]),
        ...(entry.editedPath === null ? [] : [{ field: "editedPath", path: entry.editedPath }]),
      ]),
      ...(ticket.provedBy.testPath === null
        ? []
        : [{ field: "provedBy.testPath", path: ticket.provedBy.testPath }]),
    ];
    for (const { field, path: named } of paths) {
      if (!staysInsideRepo(named)) {
        reasons.push(
          `Ticket ${ticket.number}'s ${field} "${named}" is not a path relative to the project root that stays inside it; give a relative path with no leading /, ~ or drive letter, no .. segment and no surrounding spaces.`,
        );
      }
    }

    // A ticket that changes no files, such as a spike, has no files to prove
    // itself inside, so its test may live anywhere. A null test path is a
    // ticket proved by its command alone, so there is no file to place.
    const { testPath } = ticket.provedBy;
    if (
      testPath !== null &&
      ticket.filesToChange.length > 0 &&
      !ticket.filesToChange.some((file) => samePath(file.path, testPath))
    ) {
      reasons.push(
        `Ticket ${ticket.number} is proved by ${testPath}, which is not one of its filesToChange; list the test file as a create or an edit, so the ticket may write it.`,
      );
    }

    const editedProof = editedProofReason(ticket);
    if (editedProof) reasons.push(editedProof);

    const proofCd = cdReason(
      ticket.provedBy.command,
      `Ticket ${ticket.number}'s provedBy.command`,
      input.projectRoot,
    );
    if (proofCd) reasons.push(proofCd);
  }

  const plannedOf = (change: "create" | "edit") => {
    const planned = new Map<number, string[]>();
    for (const ticket of result.tickets) {
      planned.set(ticket.number, [
        ...(planned.get(ticket.number) ?? []),
        ...ticket.filesToChange
          .filter((file) => file.change === change)
          .map((file) => file.path),
      ]);
    }
    return planned;
  };
  const createsOf = plannedOf("create");
  const editsOf = plannedOf("edit");

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
      const on = `Ticket ${ticket.number}'s buildsOn on ticket ${entry.blocker}`;
      const checkCd = cdReason(
        entry.check,
        `Ticket ${ticket.number}'s buildsOn check on ticket ${entry.blocker}`,
        input.projectRoot,
      );
      if (checkCd) reasons.push(checkCd);
      const forms = [entry.citation, entry.createdPath, entry.editedPath].filter(
        (value) => value !== null,
      ).length;
      if (forms === 0) {
        reasons.push(
          `${on} says neither where it lives nor where ticket ${entry.blocker} puts it; set exactly one of citation (existing code), createdPath (a file ticket ${entry.blocker} creates), or editedPath with symbol (what ticket ${entry.blocker} adds to a file it edits).`,
        );
        continue;
      }
      if (forms > 1) {
        reasons.push(
          `${on} sets more than one of citation, createdPath and editedPath; set exactly one, and leave the others null.`,
        );
        continue;
      }
      if (entry.editedPath !== null && entry.symbol === null) {
        reasons.push(
          `${on} names ${entry.editedPath} but no symbol; name what ticket ${entry.blocker} adds to it: a function, a route, a table or a field.`,
        );
      }
      if (entry.editedPath === null && entry.symbol !== null) {
        reasons.push(
          `${on} names the symbol ${entry.symbol} without an editedPath; a symbol goes only with the editedPath ticket ${entry.blocker} adds it to, so give that path or leave symbol null.`,
        );
      }
      if (entry.editedPath !== null) {
        const edited = editsOf.get(entry.blocker) ?? [];
        if (!edited.some((planned) => samePath(planned, entry.editedPath!))) {
          reasons.push(
            `${on} says ticket ${entry.blocker} adds to ${entry.editedPath}, which ticket ${entry.blocker} does not list as an edit in its filesToChange; name a file ticket ${entry.blocker} edits, depend on a path it creates, or cite existing code.`,
          );
        }
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

  reasons.push(...doubleCreateReasons(result, input.tickets));

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
      // Already refused above, with the reason worded for the path's shape.
      if (!staysInsideRepo(file.path)) continue;
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
        } else if (
          !isFile &&
          blockerThatCreates(file.path, ticket.number, input.tickets, result.tickets) === null
        ) {
          reasons.push(missingEditReason(ticket.number, file.path, result));
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
    // Deduplicated, batched into one call, and classified by the same
    // position-based rules `visibility.ts`'s own ignore check uses — see
    // `check-ignore.ts`.
    const unique = [...new Set(toCheckIgnored.map((entry) => entry.path))];
    const checked = await checkIgnored(realRoot, unique);
    if (checked.status === "exit-error") {
      reasons.push(
        `The files marked create could not be checked against the project's ignore rules (git check-ignore exited ${checked.exitCode}); plan ordinary paths inside the project.`,
      );
    } else if (checked.status === "count-mismatch") {
      reasons.push(
        `The files marked create could not be checked against the project's ignore rules (git check-ignore printed ${checked.lineCount} results for ${checked.pathCount} paths: ${unique.join(", ")}); plan ordinary paths inside the project.`,
      );
    } else {
      for (const entry of toCheckIgnored) {
        if (checked.ignored.get(entry.path)) {
          reasons.push(
            `Ticket ${entry.ticket} marks ${entry.path} as create, but git ignores that path, so the repository would never track it; plan a path git tracks.`,
          );
        }
      }
    }
  }

  return reasons;
}
