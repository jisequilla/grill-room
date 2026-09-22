/**
 * Which offered choice the interviewer's recommendation is a rendering of.
 *
 * The interviewer writes `recommendedAnswer` as prose and `choices` as short
 * labels, and the port carries no link between them. Without one, a user who
 * clicks the chip the interviewer recommended is recorded as having given
 * their own answer — which, for a record of where the user accepted versus
 * diverged, is worse than having no recommendation at all. This is the match,
 * made here rather than by changing the port.
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
