/**
 * Whether an own-answer's text reads as a deferral rather than a settled
 * decision. Pipe's 2026-09-25 review found own answers that defer ("Wait
 * until the first service and vetting depth are settled") stored and
 * exported as if they were decided. This is the save-time nudge (gr-ibp.1.3);
 * the interviewer's done-time check (gr-ibp.1.2) is the backstop.
 *
 * A heuristic, not a parser: a false positive costs the user one extra
 * click (dismissing the nudge), so the phrase list stays deliberately short
 * rather than growing to chase edge cases.
 */

/** Phrases that match anywhere in the text, as whole words, case-insensitive. */
const DEFERRAL_PATTERNS: readonly RegExp[] = [
  /\bwait\s+until\b/,
  /\bwait\s+for\b/,
  /\blater\b/,
  /\btbd\b/,
  /\bto\s+be\s+decided\b/,
  /\bnot\s+yet\b/,
  /\bdepends\s+on\b/,
];

/** What "once" has to be followed by, in the same sentence, to count. */
const ONCE_FOLLOWUP = /\b(?:settled|decided|known)\b/;

export function readsAsDeferral(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed === "") return false;

  const lower = trimmed.toLowerCase();

  if (DEFERRAL_PATTERNS.some((pattern) => pattern.test(lower))) {
    return true;
  }

  // A comma does not end a sentence; `.`, `!` and `?` do.
  for (const sentence of lower.split(/[.!?]/)) {
    const once = /\bonce\b/.exec(sentence);
    if (!once) continue;
    const rest = sentence.slice(once.index + once[0].length);
    if (ONCE_FOLLOWUP.test(rest)) return true;
  }

  return false;
}
