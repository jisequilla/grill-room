/**
 * Whether to nudge the user toward whole-round answering, after a long run
 * of one-at-a-time rounds. `docs/design/session-retrospective.md` (finding
 * 6): the first real session ran 96 one-card rounds in a row — a valid
 * choice, but upstream expects a handful of rounds of many questions, and the
 * app never suggested otherwise.
 *
 * Deliberately pure: the caller reads the session's answering mode and its
 * submitted rounds through the usual actions, and reads/writes the dismissal
 * itself (`round-nudge.tsx`) — localStorage has no place in a function this
 * needs to unit-test without a DOM.
 */
import type { SessionAnsweringMode } from "@shared/session-constants";

/** Trailing single-card rounds required before the nudge shows, and again before it returns after a dismissal. */
export const ROUND_NUDGE_THRESHOLD = 10;

/** As much of a submitted round as the nudge decision needs. */
export interface NudgeRound {
  cardCount: number;
}

export function shouldShowRoundNudge({
  answeringMode,
  submittedRounds,
  dismissedAtRoundCount,
}: {
  answeringMode: SessionAnsweringMode;
  /** Oldest first, matching `list-rounds`. */
  submittedRounds: readonly NudgeRound[];
  /**
   * How many submitted rounds existed when the user last dismissed the
   * nudge for this session, or null if they never have.
   */
  dismissedAtRoundCount: number | null;
}): boolean {
  if (answeringMode !== "one-at-a-time") return false;
  if (submittedRounds.length < ROUND_NUDGE_THRESHOLD) return false;

  const trailing = submittedRounds.slice(-ROUND_NUDGE_THRESHOLD);
  const allSingleCard = trailing.every((round) => round.cardCount === 1);
  if (!allSingleCard) return false;

  if (dismissedAtRoundCount === null) return true;

  // The snooze: stay hidden until at least ROUND_NUDGE_THRESHOLD more rounds
  // have been submitted since the dismissal. Combined with the trailing
  // check above, a mixed round in between resets the streak the same way it
  // would have before any dismissal happened.
  return submittedRounds.length - dismissedAtRoundCount >= ROUND_NUDGE_THRESHOLD;
}
