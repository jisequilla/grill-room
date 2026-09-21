import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * The interviewer is driven by the upstream grilling skill text, read verbatim
 * from the copy that ships beside this module, plus an app-specific addendum.
 * The skill copy must stay byte-identical to the repository's own; anything the
 * app needs beyond it belongs in the addendum, never in the skill text.
 */

export const GRILLING_SKILL_FILE = fileURLToPath(
  new URL("./instructions/grilling/SKILL.md", import.meta.url),
);

export const SPEC_TEMPLATE_FILE = fileURLToPath(
  new URL("./instructions/to-spec/spec-template.md", import.meta.url),
);

let grillingSkill: string | undefined;
let specTemplate: string | undefined;

/** The upstream grilling skill text, verbatim. */
export function loadGrillingSkill(): string {
  grillingSkill ??= readFileSync(GRILLING_SKILL_FILE, "utf8");
  return grillingSkill;
}

/** The `<spec-template>` block of the upstream to-spec skill, verbatim. */
export function loadSpecTemplate(): string {
  specTemplate ??= readFileSync(SPEC_TEMPLATE_FILE, "utf8");
  return specTemplate;
}

/**
 * What the skill text cannot know: that its reader is a structured interviewer
 * inside an app, with no tools and no sub-agents, whose dependency links are
 * the only thing the app can build a tree from.
 */
export const APP_ADDENDUM = `## How this app runs the interview

Everything above is the grilling method. It is unmodified, and it assumes a chat
window. You are running it inside Grill Room, so four things differ.

1. **Your output is structured, never formatted chat text.** Return exactly the
   JSON the schema you were given describes. The numbered-question layout in the
   skill describes what the app renders for the user; it is not what you return.
2. **Fact-finding is unavailable.** You have no tools and cannot dispatch
   sub-agents. Where the skill tells you to find a fact yourself, put the
   question to the user instead, with your best recommendation and the reason it
   matters. Never claim to have looked something up.
3. **Dependency links must be explicit.** Every decision you propose states, in
   \`dependsOn\`, the keys of the decisions it hangs off. The app builds the
   design tree from those links alone: a link you omit is a dependency the app
   cannot see, and a key you invent is a rejected proposal.
4. **Never ask, in one round, a question that depends on a decision still open.**
   That includes decisions proposed in this same round. Such a question belongs
   to a later round: add it to the tree with \`ask\` set to false, and the app
   will surface it once its prerequisites are settled.

The app, not you, decides which decisions are settled, on the frontier, blocked
or stale, and it will reject a proposal that breaks those rules. Work from the
states given to you in the request rather than from your own bookkeeping.`;

/** The full system instructions: the skill verbatim, then the addendum. */
export function interviewerInstructions(): string {
  return `${loadGrillingSkill().trimEnd()}\n\n---\n\n${APP_ADDENDUM}`;
}
