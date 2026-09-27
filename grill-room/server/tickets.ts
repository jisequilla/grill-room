/**
 * Ticket breakdown's rules, as pure functions over a proposed or stored set of
 * tickets. Nothing here reads a table or calls the interviewer: `break-into-
 * tickets` loads rows, hands the interviewer's proposal here to validate, and
 * writes back what is accepted; `get-spec` and `list-tickets` hand it stored
 * rows to describe. `validateTicketSet` and `describeTickets` are tested
 * through those actions, never directly — the same convention `tree.ts`
 * follows. `computeWaves` is tested directly (`tickets.test.ts`): its
 * ordering and cycle-naming rules are exact enough to state as unit cases
 * without an action's setup around them.
 */
import type { TicketKind, TicketStatus } from "./db/schema.js";
import { parseStringArray } from "./tree.js";

/** A ticket as the interviewer proposes it: `blockedBy` holds ticket numbers. */
export interface ProposedTicket {
  number: number;
  slug: string;
  title: string;
  body: string;
  blockedBy: readonly number[];
  /** `gate` for a prerequisite outside the code, which has no builder. */
  kind: TicketKind;
  /** What a gate waits for, in one line; null (or blank) for a build ticket. */
  waitsFor: string | null;
  /** The numbers of the spec's user stories this ticket builds. */
  implements: readonly number[];
}

export interface TicketSetValidation {
  ok: boolean;
  /** Empty when `ok`. Written for the interviewer: it is sent back verbatim. */
  reasons: string[];
}

const SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/**
 * Every number that sits on a cycle of the `blockedBy` graph, in a stable
 * order. Shared by `validateTicketSet`, `computeWaves` and any action that
 * needs to refuse an edit that would introduce a cycle — there is exactly one
 * cycle detector in this module.
 */
export function numbersOnCycles(
  byNumber: ReadonlyMap<number, { blockedBy: readonly number[] }>,
): number[] {
  const onCycle = new Set<number>();
  const done = new Set<number>();
  const onPath = new Set<number>();

  function visit(current: number, path: number[]): void {
    if (done.has(current)) return;
    if (onPath.has(current)) {
      for (const member of path.slice(path.indexOf(current))) {
        onCycle.add(member);
      }
      return;
    }

    onPath.add(current);
    path.push(current);
    for (const blocker of byNumber.get(current)?.blockedBy ?? []) {
      if (byNumber.has(blocker)) visit(blocker, path);
    }
    path.pop();
    onPath.delete(current);
    done.add(current);
  }

  for (const number of byNumber.keys()) visit(number, []);

  return [...onCycle];
}

/**
 * Whether a proposed ticket breakdown may replace a session's tickets. A
 * result is accepted or rejected whole, the same as a proposed round.
 *
 * Refused: a ticket number used more than once, numbers that do not run from
 * 1 to the ticket count with no gaps, a slug that is not lowercase letters,
 * digits and hyphens, a slug used by more than one ticket, a `blockedBy` entry
 * naming a number outside this set, a ticket that blocks itself, a gate
 * whose `waitsFor` is not one non-empty line, a build ticket that waits for
 * something, a gate no ticket lists in `blockedBy`, and a `blockedBy` graph
 * that contains a cycle.
 *
 * The cycle check only runs once numbers and links resolve cleanly — a
 * dangling or duplicated number makes the graph meaningless to walk.
 *
 * With `greenfield` (the project's repository has no commits yet), a set that
 * passes every check above is also refused when ticket 1 does not set up the
 * verify command or another ticket does not wait for ticket 1; see
 * {@link greenfieldReasons}.
 */
export function validateTicketSet(
  tickets: readonly ProposedTicket[],
  greenfield: GreenfieldRules | null = null,
): TicketSetValidation {
  const reasons: string[] = [];

  const countByNumber = new Map<number, number>();
  for (const ticket of tickets) {
    countByNumber.set(ticket.number, (countByNumber.get(ticket.number) ?? 0) + 1);
  }
  const duplicateNumbers = [...countByNumber.entries()]
    .filter(([, count]) => count > 1)
    .map(([number]) => number)
    .sort((a, b) => a - b);
  if (duplicateNumbers.length > 0) {
    reasons.push(
      `Ticket number${duplicateNumbers.length === 1 ? "" : "s"} ${duplicateNumbers.join(", ")} ${duplicateNumbers.length === 1 ? "is" : "are"} used more than once. Every ticket needs its own number.`,
    );
  }

  const expectedCount = tickets.length;
  const missingNumbers: number[] = [];
  for (let number = 1; number <= expectedCount; number += 1) {
    if (!countByNumber.has(number)) missingNumbers.push(number);
  }
  if (missingNumbers.length > 0) {
    reasons.push(
      `Ticket numbers must run from 1 to ${expectedCount} with no gaps. Missing: ${missingNumbers.join(", ")}.`,
    );
  }

  const countBySlug = new Map<string, number>();
  for (const ticket of tickets) {
    countBySlug.set(ticket.slug, (countBySlug.get(ticket.slug) ?? 0) + 1);
    if (!SLUG_PATTERN.test(ticket.slug)) {
      reasons.push(
        `Ticket ${ticket.number}'s slug "${ticket.slug}" must be lowercase and contain only letters, digits and hyphens.`,
      );
    }
  }
  const duplicateSlugs = [...countBySlug.entries()]
    .filter(([, count]) => count > 1)
    .map(([slug]) => slug)
    .sort();
  for (const slug of duplicateSlugs) {
    reasons.push(
      `Slug "${slug}" is used by more than one ticket. Slugs must be unique.`,
    );
  }

  const numbers = new Set(tickets.map((ticket) => ticket.number));
  for (const ticket of tickets) {
    for (const blocker of ticket.blockedBy) {
      if (blocker === ticket.number) {
        reasons.push(
          `Ticket ${ticket.number} lists itself in \`blockedBy\`. A ticket cannot block itself.`,
        );
      } else if (!numbers.has(blocker)) {
        reasons.push(
          `Ticket ${ticket.number} is blocked by ${blocker}, which is not a ticket number in this set.`,
        );
      }
    }
  }

  reasons.push(...gateReasons(tickets));

  if (reasons.length > 0) return { ok: false, reasons };

  const byNumber = new Map(tickets.map((ticket) => [ticket.number, ticket]));
  const cyclic = numbersOnCycles(byNumber).sort((a, b) => a - b);
  if (cyclic.length > 0) {
    reasons.push(
      `These tickets form a blocking cycle: ${cyclic.join(", ")}.`,
    );
  }

  if (reasons.length === 0 && greenfield) {
    reasons.push(...greenfieldReasons(byNumber, greenfield.verifyCommand));
  }

  return { ok: reasons.length === 0, reasons };
}

/**
 * A gate waits for something outside the code, named in one line, and holds
 * back the tickets that list it in `blockedBy`. A build ticket waits for
 * nothing: a blank `waitsFor` on one is read as none. Reasons are grouped by
 * rule, then ordered by ticket number within each rule.
 */
function gateReasons(tickets: readonly ProposedTicket[]): string[] {
  const byNumber = [...tickets].sort((a, b) => a.number - b.number);
  const reasons: string[] = [];

  for (const ticket of byNumber) {
    if (ticket.kind === "gate" && !isOneLine(ticket.waitsFor)) {
      reasons.push(
        `Ticket ${ticket.number} is a gate, so its \`waitsFor\` must say in one line what it waits for.`,
      );
    }
  }

  for (const ticket of byNumber) {
    if (ticket.kind === "build" && storedWaitsFor(ticket) !== null) {
      reasons.push(
        `Ticket ${ticket.number} is a build ticket, so its \`waitsFor\` must be null. Only a gate waits for something outside the code.`,
      );
    }
  }

  for (const ticket of byNumber) {
    if (
      ticket.kind === "gate" &&
      !tickets.some(
        (other) => other.number !== ticket.number && other.blockedBy.includes(ticket.number),
      )
    ) {
      reasons.push(
        `Ticket ${ticket.number} is a gate that no ticket lists in \`blockedBy\`. A gate exists to hold back the tickets that need it: list it in their \`blockedBy\`.`,
      );
    }
  }

  return reasons;
}

function isOneLine(text: string | null): boolean {
  return text !== null && text.trim() !== "" && !/[\r\n]/.test(text);
}

/** What a ticket's `waitsFor` is stored as: trimmed, and null when blank. */
export function storedWaitsFor(ticket: { waitsFor: string | null }): string | null {
  const trimmed = ticket.waitsFor?.trim() ?? "";
  return trimmed === "" ? null : trimmed;
}

/** The verify command a greenfield breakdown's ticket 1 sets up. */
export interface GreenfieldRules {
  verifyCommand: string;
}

/**
 * A repository with no commits has no verify command yet, so ticket 1 sets it
 * up and every other ticket waits for it: ticket 1's body names the command as
 * single-backtick inline code (skipped for a command that itself contains a
 * backtick, which cannot be written that way), and every other ticket reaches
 * ticket 1 through `blockedBy`, directly or transitively. Ticket 1 must be a
 * build ticket; a gate need not reach it, though the walk still passes
 * through a gate. Only called on a set whose numbers and links resolve and
 * hold no cycle.
 */
function greenfieldReasons(
  byNumber: ReadonlyMap<number, ProposedTicket>,
  verifyCommand: string,
): string[] {
  const reasons: string[] = [];

  const first = byNumber.get(1);
  if (first?.kind === "gate") {
    reasons.push(
      "Ticket 1 is a gate. This repository has no commits yet, so ticket 1 must be a build ticket that sets up the verify command.",
    );
  } else if (first && !verifyCommand.includes("`") && !first.body.includes(`\`${verifyCommand}\``)) {
    reasons.push(
      `Ticket 1 does not name the verify command. This repository has no commits yet, so ticket 1 sets that command up, and its body must name it in its acceptance, written as inline code: \`${verifyCommand}\`.`,
    );
  }

  const reachesFirst = new Map<number, boolean>();
  function reaches(number: number): boolean {
    const known = reachesFirst.get(number);
    if (known !== undefined) return known;
    const result = (byNumber.get(number)?.blockedBy ?? []).some(
      (blocker) => blocker === 1 || reaches(blocker),
    );
    reachesFirst.set(number, result);
    return result;
  }

  for (const number of [...byNumber.keys()].sort((a, b) => a - b)) {
    if (number !== 1 && byNumber.get(number)!.kind !== "gate" && !reaches(number)) {
      reasons.push(
        `Ticket ${number} does not depend on ticket 1. This repository has no commits yet and ticket 1 sets up the verify command, so every other ticket must list 1 in its \`blockedBy\`, directly or through another ticket's \`blockedBy\`.`,
      );
    }
  }

  return reasons;
}

/** A ticket as `computeWaves` needs it: a number and its blockers, already resolved to numbers. */
export interface TicketForWaves {
  number: number;
  blockedBy: readonly number[];
}

export interface WavesResult {
  ok: true;
  /** Wave 1 first. Each wave is sorted by ticket number. */
  waves: number[][];
}

export interface WavesCycleError {
  ok: false;
  /** Every ticket number on the cycle, sorted ascending — never a partial wave list. */
  cycle: number[];
}

/**
 * Groups a session's tickets into waves by `blockedBy`: wave 1 holds every
 * ticket with no blockers (or whose blockers fall outside this set), wave N
 * holds every ticket whose blockers are all in wave N-1 or earlier, and each
 * ticket lands in the earliest wave that rule allows it. Within a wave,
 * tickets are ordered by number. The same input always produces the same
 * output — no randomness, no dependence on map/object iteration order beyond
 * what the sort fixes.
 *
 * A cycle (which `validateTicketSet` should already have refused, so this is
 * a defensive check, not the primary one) returns every ticket number on it
 * instead of a partial or best-effort wave list.
 */
export function computeWaves(
  tickets: readonly TicketForWaves[],
): WavesResult | WavesCycleError {
  const byNumber = new Map(tickets.map((ticket) => [ticket.number, ticket]));

  const cyclic = numbersOnCycles(byNumber);
  if (cyclic.length > 0) {
    return { ok: false, cycle: cyclic.sort((a, b) => a - b) };
  }

  const waveByNumber = new Map<number, number>();
  function waveOf(number: number): number {
    const cached = waveByNumber.get(number);
    if (cached !== undefined) return cached;

    const blockers = (byNumber.get(number)?.blockedBy ?? []).filter((blocker) =>
      byNumber.has(blocker),
    );
    const wave = blockers.length === 0 ? 1 : 1 + Math.max(...blockers.map(waveOf));
    waveByNumber.set(number, wave);
    return wave;
  }

  let maxWave = 0;
  for (const number of byNumber.keys()) {
    maxWave = Math.max(maxWave, waveOf(number));
  }

  const waves: number[][] = [];
  for (let wave = 1; wave <= maxWave; wave += 1) {
    waves.push(
      [...byNumber.keys()]
        .filter((number) => waveByNumber.get(number) === wave)
        .sort((a, b) => a - b),
    );
  }

  return { ok: true, waves };
}

/** A ticket as `separateOverlaps` needs it: its blockers and the files it may create or edit. */
export interface TicketForSeparation extends TicketForWaves {
  /** Every file the ticket may create or edit. Empty when it has no grounded entry. */
  files: readonly string[];
}

/**
 * An ordering the export adds between two tickets that change the same file:
 * `ticket` waits for `waitsFor`. `waitsFor` may have the higher number, when
 * Blocked-by put it first.
 */
export interface ImplicitEdge {
  ticket: number;
  waitsFor: number;
  /** The files both tickets change, as `ticket` names them, sorted. */
  sharedPaths: string[];
}

export interface SeparatedWaves {
  ok: true;
  /** Wave 1 first. Each wave is sorted by ticket number. */
  waves: number[][];
  /** Ordered by `ticket`, then by `waitsFor`. */
  implicitEdges: ImplicitEdge[];
}

/**
 * Waves in which no two tickets change the same file. Tickets are visited in
 * dependency order, the lowest-numbered ready ticket first. Each starts in
 * the first wave after all its blockers' waves and moves one wave later while
 * that wave already holds a ticket sharing a file with it. A ticket that
 * moved waits for every ticket it shares a file with in the wave just before
 * the one it lands in. Blockers are always placed first, so a moved ticket's
 * dependents move with it. Files are compared by `keyOf`.
 *
 * A cycle returns every ticket number on it, as `computeWaves` does.
 */
export function separateOverlaps(
  tickets: readonly TicketForSeparation[],
  keyOf: (filePath: string) => string,
): SeparatedWaves | WavesCycleError {
  const byNumber = new Map(tickets.map((ticket) => [ticket.number, ticket]));

  const cyclic = numbersOnCycles(byNumber);
  if (cyclic.length > 0) {
    return { ok: false, cycle: cyclic.sort((a, b) => a - b) };
  }

  const blockersOf = new Map(
    [...byNumber.values()].map((ticket) => [
      ticket.number,
      [...new Set(ticket.blockedBy)].filter((blocker) => byNumber.has(blocker)),
    ]),
  );
  const filesOf = new Map(
    [...byNumber.values()].map((ticket) => {
      const byKey = new Map<string, string>();
      for (const file of ticket.files) {
        const key = keyOf(file);
        if (!byKey.has(key)) byKey.set(key, file);
      }
      return [ticket.number, byKey];
    }),
  );
  const sharedPaths = (ticket: number, other: number): string[] => {
    const theirs = filesOf.get(other)!;
    return [...filesOf.get(ticket)!]
      .filter(([key]) => theirs.has(key))
      .map(([, file]) => file)
      .sort();
  };

  const waveOf = new Map<number, number>();
  const members: number[][] = [];
  const implicitEdges: ImplicitEdge[] = [];

  const waiting = new Map([...blockersOf].map(([number, blockers]) => [number, blockers.length]));
  const ready = [...waiting].filter(([, count]) => count === 0).map(([number]) => number);
  while (ready.length > 0) {
    ready.sort((a, b) => a - b);
    const number = ready.shift()!;

    const blockers = blockersOf.get(number)!;
    const start = blockers.length === 0 ? 1 : 1 + Math.max(...blockers.map((b) => waveOf.get(b)!));
    let wave = start;
    while ((members[wave - 1] ?? []).some((other) => sharedPaths(number, other).length > 0)) {
      wave += 1;
    }
    if (wave > start) {
      for (const other of members[wave - 2]!) {
        const shared = sharedPaths(number, other);
        if (shared.length > 0) implicitEdges.push({ ticket: number, waitsFor: other, sharedPaths: shared });
      }
    }
    waveOf.set(number, wave);
    while (members.length < wave) members.push([]);
    members[wave - 1]!.push(number);

    for (const [dependent, blockersOfDependent] of blockersOf) {
      if (!blockersOfDependent.includes(number)) continue;
      const left = waiting.get(dependent)! - 1;
      waiting.set(dependent, left);
      if (left === 0) ready.push(dependent);
    }
  }

  implicitEdges.sort((a, b) => a.ticket - b.ticket || a.waitsFor - b.waitsFor);
  return {
    ok: true,
    waves: members.map((wave) => [...wave].sort((a, b) => a - b)),
    implicitEdges,
  };
}

/** A stored ticket row, exactly as `get-spec`, `list-tickets` and `break-into-tickets` need it. */
export interface StoredTicket {
  id: string;
  number: number;
  slug: string;
  title: string;
  body: string;
  status: TicketStatus;
  /** JSON array of ticket ids — `blockedByJson` stores ids, not numbers. */
  blockedByJson: string;
  kind: TicketKind;
  waitsFor: string | null;
  /** JSON array of user story numbers; null for tickets made before the story check. */
  implementsJson: string | null;
  createdAt: string;
  updatedAt: string;
}

/** A ticket as every read action reports it: the row, with `blockedBy` resolved to numbers. */
export interface TicketView {
  id: string;
  number: number;
  slug: string;
  title: string;
  body: string;
  status: TicketStatus;
  blockedBy: number[];
  kind: TicketKind;
  /** What a gate waits for; always null for a build ticket. */
  waitsFor: string | null;
  /** The user stories it builds; null for tickets made before the story check. */
  implements: number[] | null;
  createdAt: string;
  updatedAt: string;
}

/** Stored rows, ordered by number, with `blockedBy` resolved from ids back to ticket numbers. */
export function describeTickets(
  rows: readonly StoredTicket[],
): TicketView[] {
  const numberById = new Map(rows.map((row) => [row.id, row.number]));

  return [...rows]
    .sort((a, b) => a.number - b.number)
    .map((row) => ({
      id: row.id,
      number: row.number,
      slug: row.slug,
      title: row.title,
      body: row.body,
      status: row.status,
      blockedBy: parseStringArray(row.blockedByJson).flatMap((id) => {
        const number = numberById.get(id);
        return number === undefined ? [] : [number];
      }),
      kind: row.kind,
      waitsFor: row.waitsFor,
      implements: parseImplements(row.implementsJson),
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    }));
}

/**
 * A stored `implementsJson` read back: null for a NULL column, otherwise the
 * array's positive integers, and `[]` for text that is not a JSON array.
 */
export function parseImplements(json: string | null): number[] | null {
  if (json === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  return parsed.filter(
    (value): value is number => typeof value === "number" && Number.isInteger(value) && value > 0,
  );
}

/** What a ticket's `implements` is stored as: deduplicated and ascending. */
export function storedImplements(numbers: readonly number[]): number[] {
  return [...new Set(numbers)].sort((a, b) => a - b);
}

/** One of the spec's numbered user stories, as written. */
export interface UserStory {
  number: number;
  text: string;
}

const USER_STORIES_HEADING = /^##[ \t]+User Stories[ \t]*$/i;
const SECTION_END = /^#{1,2}[ \t]/;
const STORY_ITEM = /^(\d{1,9})[.)][ \t]+(\S.*)$/;

/**
 * The spec's numbered user stories: the column-0 ordered-list items under the
 * first `## User Stories` heading, up to the next level-1 or level-2 heading.
 * Numbers are taken as written, and a repeated number keeps its first text.
 * Only an item's first line counts; indented lines, bullets and subheadings
 * are ignored. Ascending by number.
 */
export function userStories(specMarkdown: string): UserStory[] {
  const lines = specMarkdown.split(/\r?\n/);
  const start = lines.findIndex((line) => USER_STORIES_HEADING.test(line));
  if (start === -1) return [];

  const byNumber = new Map<number, string>();
  for (const line of lines.slice(start + 1)) {
    if (SECTION_END.test(line)) break;
    const match = STORY_ITEM.exec(line);
    if (!match) continue;
    const number = Number(match[1]);
    if (!byNumber.has(number)) byNumber.set(number, match[2]!.trim());
  }

  return [...byNumber]
    .map(([number, text]) => ({ number, text }))
    .sort((a, b) => a.number - b.number);
}

/**
 * Numbers as ranges, for the prompt, the reasons and the issue file: sorted,
 * deduplicated, runs of two or more written `a-b`, joined with `, `.
 */
export function numberRanges(numbers: readonly number[]): string {
  const sorted = [...new Set(numbers)].sort((a, b) => a - b);
  const pieces: string[] = [];
  let index = 0;
  while (index < sorted.length) {
    let end = index;
    while (end + 1 < sorted.length && sorted[end + 1] === sorted[end]! + 1) end += 1;
    pieces.push(end > index ? `${sorted[index]}-${sorted[end]}` : `${sorted[index]}`);
    index = end + 1;
  }
  return pieces.join(", ");
}

/** The stories no build ticket lists in `implements`, ascending. */
export function uncoveredStories<Story extends { number: number }>(
  tickets: readonly { kind: TicketKind; implements: readonly number[] }[],
  stories: readonly Story[],
): Story[] {
  const covered = new Set(
    tickets.filter((ticket) => ticket.kind !== "gate").flatMap((ticket) => ticket.implements),
  );
  return stories
    .filter((story) => !covered.has(story.number))
    .sort((a, b) => a.number - b.number);
}

/** `user story 4`, or `user stories 4, 9-11`. */
function storiesPhrase(numbers: readonly number[]): string {
  return `${numbers.length === 1 ? "user story" : "user stories"} ${numberRanges(numbers)}`;
}

/**
 * Why a proposed set's story citations cannot be stored, written for the
 * interviewer. Per ticket, in number order: a gate that cites any story, and a
 * build ticket citing a number the spec does not have. Then, unless this is
 * the last attempt, the stories no build ticket cites. Empty when the spec
 * numbers no stories.
 */
export function storyReasons(
  tickets: readonly ProposedTicket[],
  stories: readonly number[],
  options: { lastAttempt: boolean },
): string[] {
  if (stories.length === 0) return [];
  const known = new Set(stories);
  const reasons: string[] = [];

  for (const ticket of [...tickets].sort((a, b) => a.number - b.number)) {
    if (ticket.kind === "gate") {
      if (ticket.implements.length > 0) {
        reasons.push(
          `Ticket ${ticket.number} is a gate, so it implements no user story. Leave its \`implements\` empty.`,
        );
      }
      continue;
    }
    const unknown = storedImplements(ticket.implements).filter((number) => !known.has(number));
    if (unknown.length > 0) {
      reasons.push(
        `Ticket ${ticket.number} implements ${storiesPhrase(unknown)}, which the spec does not have. The spec's user stories are ${numberRanges(stories)}.`,
      );
    }
  }

  if (!options.lastAttempt) {
    const uncovered = uncoveredStories(
      tickets,
      stories.map((number) => ({ number })),
    ).map((story) => story.number);
    if (uncovered.length > 0) {
      reasons.push(
        `${uncovered.length === 1 ? "User story" : "User stories"} ${numberRanges(uncovered)} ${uncovered.length === 1 ? "is" : "are"} in no ticket's \`implements\`. Every user story must be implemented by at least one ticket: add its number to the ticket that builds it, or add a ticket for it.`,
      );
    }
  }

  return reasons;
}

/**
 * The longest run of build tickets that must be built one after another. The
 * edges are every in-set `blockedBy` entry plus every in-set `extraEdges`
 * entry (`ticket` waits for `waitsFor`). A gate adds no length but stays on
 * the chain, and on a tie the walk back prefers a gate, so an outside wait on
 * the path shows. Null when the edges form a cycle.
 */
export function longestChain(
  tickets: readonly { number: number; blockedBy: readonly number[]; kind?: TicketKind }[],
  extraEdges: readonly { ticket: number; waitsFor: number }[] = [],
): { length: number; chain: number[] } | null {
  const byNumber = new Map<number, { blockedBy: number[]; gate: boolean }>();
  for (const ticket of tickets) {
    byNumber.set(ticket.number, { blockedBy: [], gate: ticket.kind === "gate" });
  }
  for (const ticket of tickets) {
    const blockers = byNumber.get(ticket.number)!.blockedBy;
    for (const blocker of ticket.blockedBy) {
      if (byNumber.has(blocker) && !blockers.includes(blocker)) blockers.push(blocker);
    }
  }
  for (const edge of extraEdges) {
    const blockers = byNumber.get(edge.ticket)?.blockedBy;
    if (blockers && byNumber.has(edge.waitsFor) && !blockers.includes(edge.waitsFor)) {
      blockers.push(edge.waitsFor);
    }
  }
  if (numbersOnCycles(byNumber).length > 0) return null;

  const depths = new Map<number, number>();
  function depthOf(number: number): number {
    const known = depths.get(number);
    if (known !== undefined) return known;
    const ticket = byNumber.get(number)!;
    const own = ticket.gate ? 0 : 1;
    const depth = Math.max(0, ...ticket.blockedBy.map(depthOf)) + own;
    depths.set(number, depth);
    return depth;
  }

  let end: number | null = null;
  for (const [number, ticket] of byNumber) {
    if (ticket.gate) continue;
    if (
      end === null ||
      depthOf(number) > depthOf(end) ||
      (depthOf(number) === depthOf(end) && number < end)
    ) {
      end = number;
    }
  }
  if (end === null) return { length: 0, chain: [] };

  const chain = [end];
  let current = end;
  while (byNumber.get(current)!.blockedBy.length > 0) {
    const [next] = [...byNumber.get(current)!.blockedBy].sort((a, b) => {
      const byDepth = depthOf(b) - depthOf(a);
      if (byDepth !== 0) return byDepth;
      const byGate = Number(byNumber.get(b)!.gate) - Number(byNumber.get(a)!.gate);
      if (byGate !== 0) return byGate;
      return a - b;
    });
    chain.unshift(next!);
    current = next!;
  }
  return { length: depthOf(end), chain };
}

/** The longest chain a set of `builds` build tickets may have before it is long. */
export function chainLimit(builds: number): number {
  return Math.max(4, Math.ceil(builds / 2));
}

/** A proposed set's longest chain, when it is long: over `chainLimit`. */
function longChainOf(
  tickets: readonly ProposedTicket[],
): { length: number; path: string; builds: number; limit: number } | null {
  const found = longestChain(tickets);
  if (found === null) return null;
  const builds = tickets.filter((ticket) => ticket.kind !== "gate").length;
  const limit = chainLimit(builds);
  if (found.length <= limit) return null;
  const gates = new Set(
    tickets.filter((ticket) => ticket.kind === "gate").map((ticket) => ticket.number),
  );
  const path = found.chain
    .map((number) => (gates.has(number) ? `gate ${number}` : `${number}`))
    .join(" → ");
  return { length: found.length, path, builds, limit };
}

/**
 * Why a proposed set's dependency chain is too long, written for the
 * interviewer; null when it is not long, or when the set has a cycle (refused
 * elsewhere). `break-into-tickets` sends it back at most once.
 */
export function chainReason(tickets: readonly ProposedTicket[]): string | null {
  const long = longChainOf(tickets);
  if (long === null) return null;
  return `The longest chain of tickets that must be built one after another is ${long.length} build tickets (${long.path}), in a set of ${long.builds} build tickets; keep it to ${long.limit} or fewer. List a ticket in \`blockedBy\` only when it uses that ticket's output, and give a file that many tickets change its own early ticket, so more tickets can be built side by side.`;
}

/** The attempt-log note for a set accepted with a long chain; null otherwise. */
export function chainNote(tickets: readonly ProposedTicket[]): string | null {
  const long = longChainOf(tickets);
  if (long === null) return null;
  return `Accepted with the longest chain at ${long.length} build tickets (${long.path}), over the limit of ${long.limit} for a set of ${long.builds} build tickets.`;
}

/** The facts `ticketsAreCurrent` needs from a session's spec. */
export interface SpecCurrencyFacts {
  current: boolean;
  updatedAt: string;
  ticketsGeneratedAt: string | null;
}

/**
 * Whether a session's tickets are current with its spec: the spec is
 * `current`, tickets have been generated from it at all, and that generation
 * was not earlier than the spec's `updatedAt`. `null` (no spec yet) is never
 * current.
 */
export function ticketsAreCurrent(spec: SpecCurrencyFacts | null): boolean {
  if (!spec || !spec.current || !spec.ticketsGeneratedAt) return false;
  return spec.ticketsGeneratedAt >= spec.updatedAt;
}
