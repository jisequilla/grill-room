import type { TicketKind } from "./session-constants.js";

/** A ticket as {@link blockersThroughGates} needs it. An absent `kind` means `build`. */
export interface TicketForGates {
  number: number;
  kind?: TicketKind;
  blockedBy: readonly number[];
}

/**
 * Every build ticket's blockers, with each gate replaced by that gate's own
 * blockers, recursively: a gate is never grounded, so what a build ticket
 * blocked only through a gate needs from the code is its gate's build
 * blockers. Keys are the build tickets; each list is deduplicated and
 * ascending. A blocker number outside the set is dropped, and a cycle stops
 * at a gate already visited.
 */
export function blockersThroughGates(
  tickets: readonly TicketForGates[],
): Map<number, number[]> {
  const byNumber = new Map(tickets.map((ticket) => [ticket.number, ticket]));
  const isGate = (number: number) => byNumber.get(number)?.kind === "gate";

  function collect(blockedBy: readonly number[], into: Set<number>, visitedGates: Set<number>): void {
    for (const blocker of blockedBy) {
      if (!byNumber.has(blocker)) continue;
      if (!isGate(blocker)) {
        into.add(blocker);
        continue;
      }
      if (visitedGates.has(blocker)) continue;
      visitedGates.add(blocker);
      collect(byNumber.get(blocker)!.blockedBy, into, visitedGates);
    }
  }

  const result = new Map<number, number[]>();
  for (const ticket of [...tickets].sort((a, b) => a.number - b.number)) {
    if (isGate(ticket.number)) continue;
    const blockers = new Set<number>();
    collect(ticket.blockedBy, blockers, new Set());
    blockers.delete(ticket.number);
    result.set(ticket.number, [...blockers].sort((a, b) => a - b));
  }
  return result;
}
