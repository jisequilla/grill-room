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
import type { TicketStatus } from "./db/schema.js";
import { parseStringArray } from "./tree.js";

/** A ticket as the interviewer proposes it: `blockedBy` holds ticket numbers. */
export interface ProposedTicket {
  number: number;
  slug: string;
  title: string;
  body: string;
  blockedBy: readonly number[];
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
 * naming a number outside this set, a ticket that blocks itself, and a
 * `blockedBy` graph that contains a cycle.
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

/** The verify command a greenfield breakdown's ticket 1 sets up. */
export interface GreenfieldRules {
  verifyCommand: string;
}

/**
 * A repository with no commits has no verify command yet, so ticket 1 sets it
 * up and every other ticket waits for it: ticket 1's body names the command as
 * single-backtick inline code (skipped for a command that itself contains a
 * backtick, which cannot be written that way), and every other ticket reaches
 * ticket 1 through `blockedBy`, directly or transitively. Only called on a set
 * whose numbers and links resolve and hold no cycle.
 */
function greenfieldReasons(
  byNumber: ReadonlyMap<number, ProposedTicket>,
  verifyCommand: string,
): string[] {
  const reasons: string[] = [];

  const first = byNumber.get(1);
  if (first && !verifyCommand.includes("`") && !first.body.includes(`\`${verifyCommand}\``)) {
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
    if (number !== 1 && !reaches(number)) {
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
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    }));
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
