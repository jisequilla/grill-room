import { interviewerInstructions, loadSpecTemplate } from "./instructions.js";
import { MAX_READY_UNKNOWNS } from "./schemas.js";
import type {
  AssessReadinessRequest,
  DecisionSnapshot,
  InterviewContext,
  InterviewerRequest,
} from "./types.js";

/**
 * Every turn carries the full instructions and the full decision history, even
 * when the conversation is resumed. Resume then buys continuity of the model's
 * own reasoning rather than the state itself, which is what makes the fresh
 * fallback after a failed resume equivalent rather than degraded.
 */

/**
 * The prompt is passed as a command line argument, and the grilling skill opens
 * with `---`. Without a line ahead of it the argument parser reads the whole
 * prompt as an unknown option and the turn fails before it starts, so the
 * prompt always opens with this framing line.
 */
const OPENING_LINE =
  "You are conducting a grilling interview inside the Grill Room app. Your instructions follow verbatim, then the state of the interview, then your task for this turn.";

function renderDecision(decision: DecisionSnapshot): string {
  const lines = [
    `- [${decision.key}] (${decision.state}, added by ${decision.introducedBy}) ${decision.title}`,
  ];
  if (decision.body) lines.push(`  question: ${decision.body}`);
  if (decision.choices.length > 0) {
    lines.push("  choices:");
    for (const [index, choice] of decision.choices.entries()) {
      const recommended =
        index === decision.recommendedChoice ? " (you recommended this one)" : "";
      lines.push(
        `    ${index}. ${choice.label}${recommended}${
          choice.rationale ? ` — ${choice.rationale}` : ""
        }`,
      );
    }
  }
  if (decision.recommendedAnswer) {
    lines.push(`  your recommendation was: ${decision.recommendedAnswer}`);
  }
  lines.push(
    `  depends on: ${decision.dependsOn.length > 0 ? decision.dependsOn.join(", ") : "nothing"}`,
  );
  lines.push(
    decision.answer
      ? `  answer (${decision.answer.kind}): ${decision.answer.text}`
      : "  answer: none yet",
  );
  for (const previous of decision.previousAnswers) {
    lines.push(`  previously (${previous.kind}): ${previous.text}`);
  }
  return lines.join("\n");
}

function renderContext(context: InterviewContext): string {
  const decisions =
    context.decisions.length > 0
      ? context.decisions.map(renderDecision).join("\n")
      : "(none yet: this is the first round)";

  return [
    "## The session",
    "",
    `Title: ${context.title ?? "(untitled)"}`,
    `Answering mode: ${
      context.answeringMode === "one-at-a-time"
        ? "one question at a time — propose at most one decision with `ask` true"
        : "whole round — ask the entire frontier at once"
    }`,
    ...(context.docsFolder
      ? [`Docs folder (your working directory, read only): ${context.docsFolder}`]
      : []),
    "",
    "The idea being grilled, in the user's words:",
    "",
    context.idea,
    "",
    "## The design tree so far",
    "",
    decisions,
  ].join("\n");
}

function renderRetry(rejectionReason: string | null): string {
  if (!rejectionReason) return "";
  return [
    "",
    "## Your previous answer was rejected",
    "",
    rejectionReason,
    "",
    "Produce a corrected result. Do not repeat the rejected structure.",
  ].join("\n");
}

function renderTask(
  request: Exclude<InterviewerRequest, AssessReadinessRequest>,
): string {
  switch (request.kind) {
    case "propose-round": {
      const answers =
        request.latestAnswers.length > 0
          ? request.latestAnswers
              .map(
                (answer) =>
                  `- [${answer.decisionKey}] (${answer.kind}): ${answer.text}`,
              )
              .join("\n")
          : "(nothing submitted yet)";

      const added =
        request.userAddedDecisions.length > 0
          ? request.userAddedDecisions
              .map((added) => `- [${added.key}] ${added.title}: ${added.body}`)
              .join("\n")
          : "(none)";

      return [
        "## What the user just submitted",
        "",
        answers,
        "",
        "## Decisions the user added themselves",
        "",
        added,
        "",
        "## Your task: propose the next round",
        "",
        "Recompute the frontier from the answers above and return:",
        "",
        "- `proposedDecisions`: the decisions to add to the tree. Set `ask` true",
        "  for those whose prerequisites are all settled and that belong in this",
        "  round; set `ask` false for decisions that belong in the tree now but",
        "  must wait for a prerequisite. Give each a stable `key` that is not",
        "  already used, a `choices` entry per option with its own `rationale`,",
        "  a `recommendedChoice` index naming the one you recommend (or null),",
        "  and a `recommendedAnswer` the user can accept in one action.",
        "- `pushBackResponses`: one entry for every answer above whose kind is",
        "  `pushed-back`. Withdraw the decision, replace it with a different one",
        "  (naming the replacement's key, which must be in `proposedDecisions`),",
        "  or restructure the part of the tree it sat in. Re-asking the same",
        "  question unchanged is rejected.",
        "- `userDecisionPlacements`: one entry for each decision the user added,",
        "  placed in the tree with its dependencies, reusing the user's key.",
        "- `done`: null unless the frontier is genuinely empty and nothing is",
        "  left silently assumed, in which case summarise every settled decision.",
        "",
        "An answer of `unknown`, `deferred` or `prototype-flagged` does not settle",
        "its decision: treat it as an open prerequisite and react to it, rather",
        "than moving past it.",
      ].join("\n");
    }

    case "review-stale":
      return [
        "## Your task: review the stale decisions",
        "",
        `The user reopened [${request.reopenedDecisionKey}] and changed their`,
        "answer. Every decision below sat downstream of it and is now in doubt.",
        "",
        `Stale decisions, in the order to report them: ${request.staleDecisionKeys.join(", ")}`,
        "",
        "Return one review per stale decision, in that order. For each, judge",
        "whether the new answer actually affects it:",
        "",
        "- `reconfirm` when the old answer still holds. Leave the question fields",
        "  null, the choices empty and `recommendedChoice` null; give the reason",
        "  it still holds.",
        "- `re-ask` when it does not. Supply an updated `title`, `body`, any",
        "  `choices` — each with its own `rationale` — a `recommendedChoice`",
        "  index naming the one you recommend (or null), and a",
        "  `recommendedAnswer` that takes the new answer into account.",
        "",
        "Do not re-ask a decision merely because it is downstream. Reconfirming",
        "what still holds is the point of this step.",
      ].join("\n");

    case "find-superseded":
      return [
        "## Your task: find the loose ends a later decision already answered",
        "",
        "Every decision below marked with a loose-end answer was left open by the",
        "user at the time. The interview has moved on since, and some of them may",
        "already be answered by a decision that settled later, under a different",
        "question.",
        "",
        `Loose ends to judge: ${request.looseEndKeys.join(", ")}`,
        "",
        "Return one entry in `supersessions` for each loose end above that a",
        "settled decision in the tree fully answers, naming that decision in",
        "`answeredByKey`, the answer to record on the loose end in `answer`, in",
        "the loose end's own terms, and in `reason` which decision answers it and",
        "why. Leave out every loose end you are not sure about; an empty list is",
        "the right answer when nothing has been superseded.",
        "",
        "Be conservative. A partial overlap is not a supersession: the settled",
        "decision must answer the whole of the question the loose end asks, not",
        "merely touch on it. Never invent an answer no settled decision carries —",
        "the user will see it as something they already decided.",
      ].join("\n");

    case "synthesize-spec": {
      const outOfScope =
        request.outOfScope.length > 0
          ? request.outOfScope.map((item) => `- ${item}`).join("\n")
          : "(none)";
      const openQuestions =
        request.openQuestions.length > 0
          ? request.openQuestions.map((item) => `- ${item}`).join("\n")
          : "(none)";

      return [
        "## Your task: synthesize the spec",
        "",
        "The interview is finished and confirmed. Write the spec from the settled",
        "decisions above. Do not interview and do not ask questions.",
        "",
        "Follow this template exactly: its sections, its order, and its rules.",
        "",
        loadSpecTemplate().trimEnd(),
        "",
        "Further rules for this app:",
        "",
        "- There is no codebase to explore and no test seams to negotiate. Base",
        "  the spec only on the decisions above.",
        "- The user stories list must be extremely extensive.",
        "- No file paths and no code snippets.",
        "- These loose ends were moved out of scope; they belong in Out of Scope:",
        "",
        outOfScope,
        "",
        "- These were kept as named open questions; they belong in Further Notes:",
        "",
        openQuestions,
        "",
        "Return the whole spec as markdown in `markdown`, starting at the",
        "`## Problem Statement` heading. Do not wrap it in a code fence.",
      ].join("\n");
    }

    case "break-into-tickets":
      return [
        "## Your task: break the spec into tickets",
        "",
        "Here is the finished spec:",
        "",
        request.specMarkdown,
        "",
        "Break it into implementation tickets, each sized so that one agent can",
        "complete it. Number them from 1 in the order they should be built. Give",
        "each a short kebab-case `slug`, a title, and a body that states what to",
        "build and how it will be judged. In `blockedBy`, list the numbers of the",
        "tickets that must land first; leave it empty for tickets that can start",
        "at once. Every number in `blockedBy` must be a ticket in this list, and",
        "the blocking relation must not form a cycle.",
      ].join("\n");
  }
}

/**
 * The readiness judge's opening line. Like {@link OPENING_LINE}, it keeps the
 * prompt from starting with anything the argument parser could read as an
 * option.
 */
const READINESS_OPENING_LINE =
  "You are judging, inside the Grill Room app, whether an idea is ready for a grilling interview. You are not interviewing: you read the idea once and report on it.";

/**
 * The readiness judge is not an interview turn, so it carries none of the
 * grilling method: only the idea, the rule the app checks the verdict against,
 * and, when the session has one, the docs folder it may read for context.
 */
function buildReadinessPrompt(request: AssessReadinessRequest): string {
  const { context } = request;
  return [
    READINESS_OPENING_LINE,
    "",
    "## The idea, in the user's words",
    "",
    `Title: ${context.title ?? "(untitled)"}`,
    "",
    context.idea,
    "",
    ...(context.docsFolder
      ? [
          "## The docs folder",
          "",
          `The session has a read-only docs folder, which is your working directory: ${context.docsFolder}`,
          "You may read it to understand what the idea refers to. Never modify",
          "anything, and never read outside it. Evidence still comes only from",
          "the idea's own words: the folder can explain an item, it cannot add one.",
          "",
        ]
      : []),
    "## Your task: judge whether the idea is ready to grill",
    "",
    "A grilling interview settles the design decisions of one buildable thing.",
    "It fails when the idea names nothing to build: asked to grill a process,",
    "the interviewer can only ask about methodology. Return:",
    "",
    "- `evidence`: the concrete facts the idea states — constraints, users,",
    "  existing systems, observed problems — each quoted in the idea's own",
    "  words. Never paraphrase into something the idea does not say, and never",
    "  invent a fact. An idea that states none has an empty list.",
    "- `objective`: the single buildable thing the idea is after, in one",
    "  sentence, or null when it names none.",
    "- `objectiveIsProcess`: true when that objective is a process rather than",
    "  a thing — to evaluate, decide how, compare, research, or define a",
    "  method. False when there is no objective.",
    "- `expectedOutcome`: what exists once the objective is done, or null when",
    "  the idea does not say.",
    "- `unknowns`: the open questions the idea raises that an interview would",
    "  have to settle before building could start.",
    "- `verdict`: `ready` only when all three hold — at least one evidence",
    "  item, a non-null objective that is not process, and at most",
    `  ${MAX_READY_UNKNOWNS} unknowns. Otherwise \`not-ready\`.`,
    "- `missing`: what the idea needs before it is worth grilling, each item",
    "  naming one gap the user could fill by editing the idea. Empty when the",
    "  verdict is `ready` and nothing is missing. Name gaps only; do not",
    "  rewrite the idea.",
    renderRetry(request.rejectionReason),
  ]
    .join("\n")
    .trimEnd();
}

/**
 * Builds the prompt for one turn.
 *
 * @param primed marks a conversation restarted after a failed resume, so the
 * model is told why it is seeing an interview it has no memory of.
 */
export function buildPrompt(
  request: InterviewerRequest,
  { primed = false }: { primed?: boolean } = {},
): string {
  if (request.kind === "assess-readiness") return buildReadinessPrompt(request);

  const preamble = primed
    ? [
        "## Note",
        "",
        "The earlier conversation of this interview could not be resumed, so you",
        "are seeing it fresh. The full design tree is reproduced below; treat it",
        "as your own prior work and continue from it.",
        "",
      ].join("\n")
    : "";

  return [
    OPENING_LINE,
    "",
    interviewerInstructions({ docsFolder: request.context.docsFolder }),
    "",
    "---",
    "",
    preamble,
    renderContext(request.context),
    "",
    renderTask(request),
    renderRetry(request.rejectionReason),
  ]
    .join("\n")
    .trimEnd();
}
