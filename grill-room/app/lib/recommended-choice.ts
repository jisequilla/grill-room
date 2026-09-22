/**
 * Which offered choice the interviewer's recommendation is a rendering of.
 *
 * The port now carries the link itself: the interviewer returns
 * `recommendedChoice`, an index into the choices it offered. What remains here
 * is the fallback for decisions stored before it was asked for one, where the
 * only link is that `recommendedAnswer` is a paraphrase of one of the labels.
 * It is a prefix matcher against prose and misses more often than it hits,
 * which is exactly why the index exists; a row that carries an index never
 * reaches it.
 */

/**
 * A choice's leading enumeration label: `A)`, `A.`, `A:`, `Option A`, `1)`.
 * Deliberately one alphanumeric character, so `Two states: …` is a sentence
 * that happens to contain a colon rather than a choice labelled `Two`.
 */
const LEADING_LABEL = /^(?:option\s+([a-z0-9])\b|([a-z0-9])\s*[).:])/;

function normalize(value: string | null | undefined): string {
  return (value ?? "").trim().toLowerCase();
}

function labelOf(normalized: string): string | null {
  const match = LEADING_LABEL.exec(normalized);
  if (!match) return null;
  return match[1] ?? match[2] ?? null;
}

/**
 * The index of the choice the recommendation names, or null when it names
 * none. A choice matches when, lowercased and trimmed, the recommendation
 * equals it, starts with it, or starts with its leading label token; the first
 * matching choice wins.
 */
export function recommendedChoiceIndex(
  recommendedAnswer: string | null | undefined,
  choices: readonly string[],
): number | null {
  const recommendation = normalize(recommendedAnswer);
  if (recommendation.length === 0) return null;

  const recommendationLabel = labelOf(recommendation);

  for (const [index, raw] of choices.entries()) {
    const choice = normalize(raw);
    if (choice.length === 0) continue;

    if (recommendation === choice) return index;
    if (recommendation.startsWith(choice)) return index;

    const choiceLabel = labelOf(choice);
    if (choiceLabel === null) continue;

    const token = LEADING_LABEL.exec(choice)?.[0] ?? "";
    if (token.length > 0 && recommendation.startsWith(token)) return index;
    if (recommendationLabel === choiceLabel) return index;
  }

  return null;
}

/** A decision's choices, as the workspace reads them. */
interface ChoiceWithRationale {
  label: string;
  rationale: string;
}

/**
 * Which choice to mark as the recommendation, for a decision the workspace is
 * rendering: the index the interviewer gave, and only failing that — for a row
 * whose choices carry no rationale, which is what a row stored before this
 * looks like — the prose match above.
 *
 * A row written since the interviewer was asked for the index and told to set
 * it to null when its recommendation is none of the choices means that null: it
 * is an answer, not a gap, so guessing past it would reintroduce the very
 * mismarking the index was added to end.
 */
export function resolveRecommendedChoice(decision: {
  choices: readonly ChoiceWithRationale[];
  recommendedChoice: number | null;
  recommendedAnswer: string | null;
}): number | null {
  const { choices, recommendedChoice } = decision;

  if (recommendedChoice != null) {
    return recommendedChoice >= 0 && recommendedChoice < choices.length
      ? recommendedChoice
      : null;
  }

  if (choices.some((choice) => choice.rationale !== "")) return null;

  return recommendedChoiceIndex(
    decision.recommendedAnswer,
    choices.map((choice) => choice.label),
  );
}
