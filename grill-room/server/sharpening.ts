/**
 * Sharpening: the short grill a not-ready idea may go through before round 1,
 * in rounds of direction cards, a rewritten idea and a readiness judgment.
 *
 * These are the server checks on the two sharpening turns. The model judges
 * what each card asks and how the idea is rewritten; the app checks what it
 * can count: card keys, the first round's directions, the rewrite's length and
 * the answers it says it uses.
 */
import {
  FIRST_ROUND_SHARPENING_DIRECTIONS,
  MAX_SHARPENED_IDEA_LENGTH,
  type SharpenCardsResult,
  type SharpeningAnswerKind,
  type SharpenRewriteResult,
} from "./interviewer/index.js";
import { normalizeForComparison } from "./readiness.js";
import { recommendedChoiceRejection } from "./tree.js";

/**
 * Why a round of direction cards cannot be stored, written for the
 * interviewer: every card's key reasons in card order, then every card's
 * choice reason in card order, then, in the first round, the directions it
 * leaves out. `usedKeys` holds every key the tree or an earlier card uses.
 */
export function reasonsToRefuseSharpenCards(
  result: SharpenCardsResult,
  options: { usedKeys: readonly string[]; firstRound: boolean },
): string[] {
  const used = new Set(options.usedKeys);
  const keyReasons: string[] = [];
  const reportedUsed = new Set<string>();
  const seen = new Set<string>();

  for (const card of result.cards) {
    if (used.has(card.key)) {
      if (!reportedUsed.has(card.key)) {
        reportedUsed.add(card.key);
        keyReasons.push(
          `Card key "${card.key}" is already used by a decision or an earlier card. Choose a new key.`,
        );
      }
    } else if (seen.has(card.key)) {
      keyReasons.push(
        `Card key "${card.key}" is used twice in this round. Give each card its own key.`,
      );
    }
    seen.add(card.key);
  }

  const choiceReasons = result.cards.flatMap((card) => {
    const reason = recommendedChoiceRejection({
      ...card,
      dependsOn: [],
      ask: true,
    });
    return reason === null ? [] : [reason];
  });

  const reasons = [...keyReasons, ...choiceReasons];

  if (options.firstRound) {
    const asked = new Set(result.cards.map((card) => card.direction));
    const missing = FIRST_ROUND_SHARPENING_DIRECTIONS.filter(
      (direction) => !asked.has(direction),
    );
    if (missing.length > 0) {
      reasons.push(
        `The first round must ask at least one card for each of what, who and outcome; it has none for ${missing.join(", ")}.`,
      );
    }
  }

  return reasons;
}

/** Whether an answer settles its card: anything but `I don't know`. */
function isSettling(kind: SharpeningAnswerKind): boolean {
  return kind === "accepted-recommendation" || kind === "own-answer";
}

/**
 * Why a rewritten idea cannot be stored, written for the interviewer: its
 * length, an unchanged idea, a settling answer it does not use, a key it names
 * twice, an `I don't know` answer it claims to use, and a key that is no card
 * of this round, each group in that order. `answers` holds this round's cards
 * in card order, at least one of them settling.
 */
export function reasonsToRefuseSharpenRewrite(
  result: SharpenRewriteResult,
  options: {
    currentIdea: string;
    answers: readonly { key: string; kind: SharpeningAnswerKind }[];
  },
): string[] {
  const reasons: string[] = [];

  const length = result.idea.trim().length;
  if (length > MAX_SHARPENED_IDEA_LENGTH) {
    reasons.push(
      `The rewritten idea is ${length} characters; it may be at most ${MAX_SHARPENED_IDEA_LENGTH}.`,
    );
  }

  if (
    normalizeForComparison(result.idea) ===
    normalizeForComparison(options.currentIdea)
  ) {
    reasons.push(
      "The rewritten idea is the current idea. Rewrite it from this round's answers.",
    );
  }

  const usedKeys = result.uses.map((use) => use.cardKey);
  const named = new Set(usedKeys);

  for (const answer of options.answers) {
    if (isSettling(answer.kind) && !named.has(answer.key)) {
      reasons.push(
        `The rewrite does not say how it uses the answer to "${answer.key}".`,
      );
    }
  }

  const seen = new Set<string>();
  for (const key of usedKeys) {
    if (seen.has(key)) {
      reasons.push(`The rewrite names "${key}" more than once in uses.`);
    }
    seen.add(key);
  }

  const kindByKey = new Map(
    options.answers.map((answer) => [answer.key, answer.kind]),
  );
  const firstUses = [...named];

  for (const key of firstUses) {
    const kind = kindByKey.get(key);
    if (kind !== undefined && !isSettling(kind)) {
      reasons.push(`"${key}" was answered "I don't know"; leave it out of uses.`);
    }
  }

  for (const key of firstUses) {
    if (!kindByKey.has(key)) {
      reasons.push(`"${key}" is not a card of this round.`);
    }
  }

  return reasons;
}
