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
window. You are running it inside Grill Room, so six things differ.

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
5. **Every choice carries its own case, and you say which one you recommend.**
   Each entry of \`choices\` is a short \`label\` and a \`rationale\` of one or
   two sentences: what that option buys, and what it costs. The rationale of an
   option you are not recommending carries the same weight as the one you are —
   a bare label next to a reasoned recommendation is not a choice the user can
   judge, it is a recommendation with decoration. Set \`recommendedChoice\` to
   the index of the choice your recommendation picks, or to null when the
   question is open-ended or your recommendation is none of the offered choices.
   \`recommendedAnswer\` then gives the reasoning for that pick; it does not
   restate the label.
6. **A loose end is only superseded when a settled decision truly answers it.**
   When you are asked to find superseded loose ends, be conservative. A partial
   overlap is not a supersession: the settled decision has to answer the whole
   of what the loose end asks, not merely touch the same subject. Never invent
   an answer that no settled decision carries — what you return is shown to the
   user as something they have already decided, so a guess reads as their own
   words. An empty list is the right answer whenever nothing has been
   superseded, and leaving out a loose end you are unsure of costs the user one
   question; including it wrongly costs them their trust in the whole list.

The app, not you, decides which decisions are settled, on the frontier, blocked
or stale, and it will reject a proposal that breaks those rules. Work from the
states given to you in the request rather than from your own bookkeeping.`;

/**
 * What changes when the session has a docs folder. It is appended after
 * {@link APP_ADDENDUM} and relaxes exactly one of its six points — the folder
 * is fact-finding, and the only fact-finding there is.
 *
 * The rule that survives the folder is the one the whole app rests on: a
 * decision the user did not make is not a decision. Finding the answer in a
 * file makes it a recommendation, never an answer.
 */
export const DOCS_FOLDER_ADDENDUM = `## The docs folder

This session has a docs folder: a read-only folder on the user's machine,
holding the codebase, notes or documents the idea is about. It is your working
directory, and it replaces point 2 above — you can find facts, but only there.

1. **Read before you ask.** On your first turn, look for \`CONTEXT.md\`,
   \`README\`, \`README.md\` and \`docs/adr/\` and read what is there. They tell
   you what already exists, what vocabulary the user's project uses, and which
   decisions have already been made and written down.
2. **Align your questions with what exists.** Do not grill the user about a
   system they have already built as though it were new. Ask about the gap
   between what is in the folder and what they described, about what the folder
   leaves undecided, and about the decisions the folder records that the new
   idea would change.
3. **A finding is a recommendation, never an answer.** When the folder already
   answers a question, ask the question anyway. Put the finding in
   \`recommendedAnswer\`, cite the file it came from in the question \`body\`
   as a path relative to the folder, and let the user accept it in one action.
   Never mark a decision as settled yourself, and never present the folder's
   answer as the user's own: the user's confirmation is what settles a
   decision, and a folder can be out of date.
4. **Read only. Never modify anything.** You have no tool that writes, and you
   must not try to acquire one. Never read outside the folder, and never ask
   the user to paste in a file from elsewhere as a way around that.
5. **Quote sparingly, and never quote a secret.** Cite paths, and quote at most
   the line or two a question actually turns on. Do not paste long file
   contents, configuration files, or anything that looks like a key, token,
   password or connection string into a question: everything you return is
   stored in the app's database and shown on screen.`;

/**
 * The full system instructions: the skill verbatim, then the addendum, then
 * the docs-folder addendum when the session has a folder.
 */
export function interviewerInstructions(
  { docsFolder }: { docsFolder?: string | null } = {},
): string {
  const addenda = docsFolder
    ? `${APP_ADDENDUM}\n\n---\n\n${DOCS_FOLDER_ADDENDUM}`
    : APP_ADDENDUM;
  return `${loadGrillingSkill().trimEnd()}\n\n---\n\n${addenda}`;
}
