import { interviewerInstructions, loadSpecTemplate } from "./instructions.js";
import {
  MAX_HANDOFF_SCOUT_BUILDS_ON,
  MAX_HANDOFF_SCOUT_BUILDS_ON_FILES,
  MAX_HANDOFF_SCOUT_FACTS,
  MAX_HANDOFF_SCOUT_FILES_TO_CHANGE,
  MAX_HANDOFF_SCOUT_TICKETS,
  MAX_READY_UNKNOWNS,
  MAX_SCOUT_CURRENT_STATE,
  MAX_SCOUT_PROPOSED_DECISIONS,
} from "./schemas.js";
import type {
  AssessReadinessRequest,
  DecisionSnapshot,
  HandoffScoutRequest,
  HandoffScoutTicket,
  InterviewContext,
  InterviewerRequest,
  ProjectServerFacts,
  ScoutProjectRequest,
  ScoutReportForReadiness,
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
  if (decision.repo) {
    lines.push(
      `  from the repo (${decision.repo.source}, cited at ${decision.repo.citation}): ${decision.repo.statement}`,
    );
  }
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

/**
 * The session's project, as its scout report describes it: context for the
 * interview, never decisions. Nothing at all without a report.
 */
function renderProjectContext(context: InterviewContext): string[] {
  const project = context.projectContext;
  if (!project) return [];

  const currentState =
    project.currentState.length > 0
      ? project.currentState
          .map(
            (item) =>
              `- (${item.status}) ${item.summary} — ${item.citations.join(", ")}`,
          )
          .join("\n")
      : "(none)";
  const dropped =
    project.droppedDecisions.length > 0
      ? project.droppedDecisions
          .map(
            (decision) =>
              `- [${decision.key}] (${decision.source}, cited at ${decision.citation}) ${decision.title}: ${decision.statement} — ${decision.reason}`,
          )
          .join("\n")
      : "(none)";

  return [
    "## The project",
    "",
    "The session's project was scouted for this idea.",
    project.stale
      ? `The scout report is stale: it was read at commit ${project.commitRead ?? "(no commits yet)"}, and the project or the idea has changed since. Use it as context, but weigh it accordingly.`
      : `The scout report is current, read at commit ${project.commitRead ?? "(no commits yet)"}.`,
    "",
    "What already exists relative to the idea (built, partial, or a gap):",
    "",
    currentState,
    "",
    "Do not ask the user about ground this already settles; build on what is",
    "built, and ask about the gaps.",
    "",
    "Repo decisions the user dropped. They are context, not constraints: the",
    "user chose not to enforce them, so a decision may depart from them, but",
    "say so when one does.",
    "",
    dropped,
    "",
  ];
}

function renderContext(context: InterviewContext): string {
  const decisions =
    context.decisions.length > 0
      ? context.decisions.map(renderDecision).join("\n")
      : "(none yet: this is the first round)";
  const hasRepoDecisions = context.decisions.some(
    (decision) => decision.introducedBy === "repo",
  );

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
    ...renderProjectContext(context),
    "## The design tree so far",
    "",
    decisions,
    ...(hasRepoDecisions
      ? [
          "",
          "Decisions added by `repo` are choices the project has already made,",
          "which the user kept from the scout report. They are the project's",
          "constraints: while settled, never ask one again and never propose a",
          "decision that contradicts it. New decisions may depend on them by",
          "key, like any settled decision. Only the user can change one, by",
          "reopening it; a reopened repo decision is asked like any other, and",
          "its answer is a deliberate change to the project.",
        ]
      : []),
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

/**
 * `text` in a code block whose fence is one backtick longer than the longest
 * run of backticks inside it (at least three), so no string in the text, such
 * as a command quoting ``` itself, can close the block early.
 */
function fenced(text: string, language: string): string[] {
  const longestRun = Math.max(0, ...(text.match(/`+/g) ?? []).map((run) => run.length));
  const fence = "`".repeat(Math.max(3, longestRun + 1));
  return [`${fence}${language}`, text, fence];
}

/**
 * The retry section for a request kind whose scout never resumes a
 * conversation — the project scout, the readiness judge and the handoff
 * scout. Each attempt is large and mostly right when it is refused, so the
 * model gets its previous answer back and is told to correct only what the
 * reasons name: rewriting everything re-reads the project for minutes and
 * breaks entries that had already passed.
 */
function renderRetryWithPreviousResult(
  rejectionReason: string | null,
  previousResult: unknown | null,
): string {
  if (!rejectionReason) return "";
  return [
    "",
    "## Your previous answer was rejected",
    "",
    rejectionReason,
    ...(previousResult
      ? [
          "",
          "Your previous answer, exactly as the app received it:",
          "",
          ...fenced(JSON.stringify(previousResult, null, 2), "json"),
        ]
      : []),
    "",
    "Correct only what the reasons above name:",
    "",
    "- Keep every entry the reasons do not name exactly as it is in your",
    "  previous answer: it already passed every check.",
    "- Change only the entries the reasons name.",
    "- Do not re-read files already read for your previous answer unless a",
    "  reason concerns them.",
  ].join("\n");
}

function renderTask(
  request: Exclude<
    InterviewerRequest,
    AssessReadinessRequest | ScoutProjectRequest | HandoffScoutRequest
  >,
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

    case "find-superseded": {
      const looseEndSection = [
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
      ];
      const replacementSection = [
        request.looseEndKeys.length > 0
          ? "## Also: settled decisions a later decision replaced"
          : "## Your task: find settled decisions a later decision replaced",
        "",
        "Decisions to check, each followed by the decisions that settled after it:",
        ...request.replaceableKeys.map(
          (key) => `- ${key}: ${(request.laterKeys[key] ?? []).join(", ")}`,
        ),
        "",
        "Return one entry in `replacements` for each decision above whose answer one",
        "of the decisions listed after it changes, narrows or reverses, so that a builder",
        "reading the earlier answer alone would build the wrong thing. Name the earlier",
        "decision in `replacedKey`, the later one (from its list) in `byKey`, and say in `reason` what",
        "the later decision changes. A later decision that only adds detail the earlier",
        "one left open is not a replacement. Be conservative: an empty list is the right",
        "answer when nothing was replaced.",
      ];
      const deferralSection = [
        request.looseEndKeys.length > 0 || request.replaceableKeys.length > 0
          ? "## Also: own answers that defer the question instead of deciding it"
          : "## Your task: find own answers that defer the question instead of deciding it",
        "",
        `Own answers to check: ${request.deferrableKeys.join(", ")}`,
        "",
        "Each decision above was settled with the user's own words. Return one entry in",
        "`deferrals` for each whose answer does not decide the question but postpones it",
        "until something else is known: \"wait until…\", \"decide later\", \"TBD\", \"once X",
        "is settled\", \"depends on Y\" with no choice made. Name the decision in `key` and",
        "say in `reason` what the answer waits on.",
        "",
        "An answer that decides and names a condition for revisiting it is not a deferral:",
        "\"48 h hold; revisit after launch\" decides 48 h. Be conservative: an empty list is",
        "the right answer when every own answer decides its question.",
      ];
      const restatementSection = [
        request.looseEndKeys.length > 0 ||
        request.replaceableKeys.length > 0 ||
        request.deferrableKeys.length > 0
          ? "## Also: own answers that hold more than the decision"
          : "## Your task: find own answers that hold more than the decision",
        "",
        `Own answers to check: ${request.restatableKeys.join(", ")}`,
        "",
        "Each decision above was settled with the user's own words, and its answer is",
        "exported as the decision for build agents to read. Return one entry in",
        "`restatements` for each answer that holds text that is not part of the",
        "decision: an instruction or question addressed to the AI or the interviewer,",
        "a note to self, or an obvious typo. Name the decision in `key`.",
        "",
        "`statement` is the decision in the owner's words, with typos fixed, nothing",
        "added and the meaning unchanged. `operatorNotes` is the text you removed,",
        "verbatim, or `\"\"` when you only fixed typos. Say in `reason` what you removed",
        "or fixed.",
        "",
        "Be conservative: an answer that is already a clean decision gets no entry,",
        "and an empty list is the right answer when every own answer is one.",
      ];
      const sections: string[][] = [];
      if (request.looseEndKeys.length > 0) sections.push(looseEndSection);
      if (request.replaceableKeys.length > 0) sections.push(replacementSection);
      if (request.deferrableKeys.length > 0) sections.push(deferralSection);
      if (request.restatableKeys.length > 0) sections.push(restatementSection);
      return sections.map((lines) => lines.join("\n")).join("\n\n");
    }

    case "synthesize-spec": {
      const outOfScope =
        request.outOfScope.length > 0
          ? request.outOfScope.map((item) => `- ${item}`).join("\n")
          : "(none)";
      const openQuestions =
        request.openQuestions.length > 0
          ? request.openQuestions.map((item) => `- ${item}`).join("\n")
          : "(none)";
      const reopenedRepo =
        request.reopenedRepoDecisions.length > 0
          ? [
              "- These decisions the project had already made were reopened in",
              "  the interview and changed. State each one, in Implementation",
              "  Decisions, as a deliberate change to the project: what the",
              "  project held, where it was recorded, and what replaces it.",
              "",
              request.reopenedRepoDecisions
                .map(
                  (decision) =>
                    `  - [${decision.key}] ${decision.title} (${decision.source}, cited at ${decision.citation}): the project held "${decision.replacedStatement}"; the interview changed it to "${decision.answer}".`,
                )
                .join("\n"),
              "",
            ]
          : [];

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
        ...reopenedRepo,
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
        "",
        "Each ticket must leave the build green on its own, since its builder",
        "verifies it alone. So keep together in one ticket:",
        "",
        "- a spec or contract change, its regeneration, and whatever keeps the",
        "  build green after it, such as a stub handler for a method the",
        "  regenerated interface gains;",
        "- a unit of code and its tests: the ticket that builds the code writes",
        "  its tests, rather than leaving them to a tests-only ticket.",
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
 * The scout report a readiness judge reads, rendered the same way whether it
 * is current or stale: current state grouped loosely and proposed repo
 * decisions with their disposition, both cited, so the judge can turn them
 * into repo-sourced evidence.
 */
function renderReadinessScoutReport(
  report: ScoutReportForReadiness | null,
): string[] {
  if (!report) {
    return [
      "## The project",
      "",
      "This session has no current scout report of its project (no project is",
      "registered, or none has been scouted yet). Every evidence item you",
      "return must be sourced from the idea.",
      "",
    ];
  }

  const currentState =
    report.currentState.length > 0
      ? report.currentState
          .map(
            (item) =>
              `- (${item.status}) ${item.summary} — ${item.citations.join(", ")}`,
          )
          .join("\n")
      : "(none)";
  const proposedDecisions =
    report.proposedDecisions.length > 0
      ? report.proposedDecisions
          .map(
            (decision) =>
              `- [${decision.key}] (${decision.source}, ${decision.disposition} by the user, cited at ${decision.citation}) ${decision.title}: ${decision.statement} — ${decision.reason}`,
          )
          .join("\n")
      : "(none)";

  return [
    "## The project's scout report",
    "",
    report.stale
      ? `This report is stale: it no longer matches the project's current commit or the current idea. Its commit was ${report.commitRead ?? "(no commits yet)"}. Use it for context, but weigh it accordingly.`
      : `This report is current, read at commit ${report.commitRead ?? "(no commits yet)"}.`,
    "",
    "Current state relative to the idea:",
    "",
    currentState,
    "",
    "Proposed repo decisions bearing on the idea:",
    "",
    proposedDecisions,
    "",
    "Use the current state and the proposed decisions above as repo evidence:",
    "an evidence item drawn from one of them has `source` `repo` and a",
    "`citation` copied exactly from the item it came from. Never invent a",
    "citation, and never give a repo item a citation you did not read above.",
    "",
  ];
}

/**
 * The readiness judge is not an interview turn, so it carries none of the
 * grilling method: only the idea, the session's scout report when it has one,
 * the rule the app checks the verdict against, and, when the session has one,
 * the docs folder it may read for context.
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
          "anything, and never read outside it. Evidence from the idea still",
          "comes only from the idea's own words: the folder can explain an item,",
          "it cannot add one.",
          "",
        ]
      : []),
    ...renderReadinessScoutReport(request.scoutReport),
    "## Your task: judge whether the idea is ready to grill",
    "",
    "A grilling interview settles the design decisions of one buildable thing.",
    "It fails when the idea names nothing to build: asked to grill a process,",
    "the interviewer can only ask about methodology. Return:",
    "",
    "- `evidence`: facts about the world *other than the objective* — a",
    "  constraint, a user, an existing system, an observed problem. Each item",
    "  is `{ text, source, citation }`. When `source` is `idea`, `text` is",
    "  quoted in the idea's own words and `citation` is null. When `source` is",
    "  `repo`, `text` is drawn from the scout report's current state or",
    "  proposed decisions above and `citation` is copied from that item. A",
    "  sentence that only states what to build, or restates the objective in",
    "  other words, is never evidence, even quoted verbatim, whatever its",
    "  source. Never paraphrase into something the idea or the report does",
    "  not say, and never invent a fact or a citation. An idea that is only",
    "  its goal, scouted against a project with nothing relevant, has an",
    "  empty evidence list.",
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
    renderRetryWithPreviousResult(request.rejectionReason, request.previousResult),
  ]
    .join("\n")
    .trimEnd();
}

/** The scout's opening line. Like {@link OPENING_LINE}, it cannot be read as an option. */
const SCOUT_OPENING_LINE =
  "You are scouting a project's repository, inside the Grill Room app, for one idea that is about to be grilled. You are not interviewing: you read the project and report what it already has and has already decided.";

/**
 * What every scout is told about the project it reads: the root is its
 * working directory, it can only read, secrets are denied, and a file hidden
 * from it is not evidence of absence.
 */
function renderProjectAccess(projectRoot: string): string[] {
  return [
    "## The project",
    "",
    `The project's root is your working directory: ${projectRoot}`,
    "You can read it with Read, Grep and Glob, and nothing else. Never modify",
    "anything, and never read outside it. Secret files (environment files,",
    "keys, certificates, credentials) are denied to you: do not try to open",
    "them, and never repeat a secret value if you meet one.",
    "Those files, and the `.git` folder, are hidden from you on purpose: Read",
    "refuses them and Glob and Grep pass over them. The absence of a file or",
    "folder from Glob or Grep is therefore never evidence that it does not",
    "exist, and the report must not claim something is missing on that",
    "absence alone.",
    "",
  ];
}

/**
 * The exclusivity rule, for whatever a scout states from cited lines: one
 * citation shows what is there, never what is not.
 */
function exclusivityRule(subject: string): string[] {
  return [
    `  ${subject} states only what its cited lines show: it must not claim`,
    "  something is the only way, the sole caller, that it never happens, or",
    "  that there is no alternative, since one cited line cannot show an absence.",
  ];
}

/** How every scout cites, and what the app does with a wrong citation. */
const CITATION_RULES = [
  "Every citation is a path relative to the project root, a colon, and a",
  "line number or an inclusive line range: `src/server.ts:42` or",
  "`docs/adr/0003-queue.md:5-12`. Cite only files you actually opened and",
  "lines you actually read. Never invent a path, and never cite a line past",
  "the end of its file: the app checks every citation against the repository",
  "and rejects the whole report if any one is wrong.",
];

function renderFacts(facts: ProjectServerFacts): string {
  const remotes =
    facts.remotes.length > 0
      ? facts.remotes
          .map((remote) => `${remote.name} ${remote.url} (${remote.type})`)
          .join("; ")
      : "(none)";
  const commits =
    facts.recentCommitSubjects.length > 0
      ? facts.recentCommitSubjects.map((subject) => `  - ${subject}`).join("\n")
      : "  (none)";
  const decisionFiles =
    facts.decisionFiles.length > 0
      ? facts.decisionFiles.map((filePath) => `  - ${filePath}`).join("\n")
      : "  (none)";
  return [
    `- HEAD commit: ${facts.headCommit ?? "(no commits yet)"}`,
    `- Branch: ${facts.headBranch ?? "(no commits yet)"}`,
    `- Remotes: ${remotes}`,
    `- Uncommitted changes in the working tree: ${facts.dirty ? "yes" : "no"}`,
    `- Agent instructions at the root (CLAUDE.md, AGENTS.md): ${facts.hasAgentInstructions ? "yes" : "no"}`,
    `- Decisions folder: ${facts.decisionsFolder ?? "(none found)"}`,
    `- Rules folder: ${facts.hasRulesFolder ? "yes" : "no"}`,
    "- Recorded decision files (decisions.md) the project tracks:",
    decisionFiles,
    "- Recent commit subjects, newest first:",
    commits,
  ].join("\n");
}

function renderPreviousDecisions(request: ScoutProjectRequest): string[] {
  if (request.previousDecisions.length === 0) {
    return [
      "- `previousDecisions`: this is the first scout of this session, so",
      "  return an empty list.",
    ];
  }
  const previous = request.previousDecisions
    .map(
      (decision) =>
        `  - [${decision.key}] (${decision.source}, ${decision.disposition} by the user, cited at ${decision.citation}) ${decision.title}: ${decision.statement}`,
    )
    .join("\n");
  return [
    "- `previousDecisions`: the previous scout report proposed these",
    "  decisions. Return exactly one entry for every one of them, by key:",
    "  `unchanged` when the repo still holds it as stated, `changed` when the",
    "  repo now holds something different (put what it now holds in",
    "  `statement`), `removed` when the repo no longer supports it. Leave",
    "  `statement` null unless the change is `changed`. When a previous",
    "  decision still bears on the idea, propose it again under the same key.",
    "",
    previous,
  ];
}

/**
 * The scout reads the project, not the interview: it carries none of the
 * grilling method, only the idea, the facts the server collected, the report
 * schema's rules and, on a re-run, the previous report's decisions.
 */
function buildScoutPrompt(request: ScoutProjectRequest): string {
  return [
    SCOUT_OPENING_LINE,
    "",
    "## The idea, in the user's words",
    "",
    `Title: ${request.context.title ?? "(untitled)"}`,
    "",
    request.context.idea,
    "",
    ...renderProjectAccess(request.projectRoot),
    "What the app already knows about the repository, from git and the file",
    "system. Use it to decide where to look first: decisions and conventions",
    "usually live in the agent instructions, the decisions folder, the rules",
    "folder, and the decision files listed below.",
    "",
    renderFacts(request.facts),
    "",
    "## Your task: report what the project already has and has decided",
    "",
    "Read the project for this idea, and only for this idea. Return:",
    "",
    `- \`currentState\`: at most ${MAX_SCOUT_CURRENT_STATE} items, each something that`,
    "  already exists relative to the idea, with `status` `built` (already does",
    "  what the idea needs), `partial` (exists but falls short) or `gap` (the idea",
    "  needs it and nothing is there yet), a one-sentence `summary`, and at least",
    "  one citation of where it lives, or for a gap, of where it would belong.",
    `- \`proposedDecisions\`: at most ${MAX_SCOUT_PROPOSED_DECISIONS} choices the project has already`,
    "  made that bear on this idea. Propose only decisions that constrain how",
    "  the idea gets built; leave out everything else the project decided.",
    "  Each has a stable kebab-case `key` (the same key for the same decision",
    "  on a later scout), a short `title`, the `statement` as the project holds",
    "  it, a `source`, one `citation`, and a one-line `reason` saying why it",
    "  matters for this idea. The source is `recorded` only when the decision is",
    "  written down in an ADR or decisions file, the agent instructions or a",
    "  rules file, cited there; it is `inferred` when you read it from code or",
    "  configuration, cited at the line you read it from.",
    ...exclusivityRule("An inferred decision"),
    "  Only a recorded decision whose document states an exclusivity may claim",
    "  it; if you believe one holds but no document records it, state the",
    "  positive part alone or leave the decision out.",
    "",
    "A decisions.md entry that carries a Supersedes line overrides the source",
    "it quotes: propose the entry's own decision, cited to its line in",
    "decisions.md, and not the statement it supersedes.",
    ...renderPreviousDecisions(request),
    "",
    ...CITATION_RULES,
    "",
    "When the project has nothing relevant to the idea, say so with empty",
    "lists rather than stretching an unrelated item to fit.",
    renderRetryWithPreviousResult(request.rejectionReason, request.previousResult),
  ]
    .join("\n")
    .trimEnd();
}

/** The handoff scout's opening line. Like {@link OPENING_LINE}, it cannot be read as an option. */
const HANDOFF_SCOUT_OPENING_LINE =
  "You are grounding the briefs of a handoff in a project's repository, inside the Grill Room app. You are not interviewing and you change nothing: you read the project and report, for every ticket, what it touches, what it builds on, and what proves it.";

function renderHandoffTicket(ticket: HandoffScoutTicket): string {
  return [
    `### Ticket ${ticket.number}: ${ticket.title}`,
    "",
    `Blocked by: ${
      ticket.blockedBy.length > 0 ? ticket.blockedBy.join(", ") : "none"
    }`,
    "",
    ticket.body,
  ].join("\n");
}

/**
 * The handoff scout reads the project for the work the spec and tickets
 * define. Like the project scout, it carries none of the grilling method: only
 * the idea, the spec, the tickets with their blockers, the facts the server
 * collected and the result's rules.
 */
function buildHandoffScoutPrompt(request: HandoffScoutRequest): string {
  const tickets =
    request.tickets.length > 0
      ? request.tickets.map(renderHandoffTicket).join("\n\n")
      : "(none)";
  return [
    HANDOFF_SCOUT_OPENING_LINE,
    "",
    "## The idea, in the user's words",
    "",
    `Title: ${request.context.title ?? "(untitled)"}`,
    "",
    request.context.idea,
    "",
    ...renderProjectAccess(request.projectRoot),
    "What the app already knows about the repository, from git and the file",
    "system. Use it to decide where to look first: conventions usually live in",
    "the agent instructions, the decisions folder and the rules folder.",
    "",
    renderFacts(request.facts),
    "",
    "## The spec",
    "",
    request.specMarkdown,
    "",
    "## The tickets",
    "",
    tickets,
    "",
    "## Your task: ground every ticket's brief in the code",
    "",
    "The idea, the spec and the tickets define the work; the code defines the",
    "facts. Take what each ticket must do from its text, and take what exists,",
    "where it lives and what it is called from the code alone. Where the spec",
    "assumes something the code does not show, report what the code shows.",
    "",
    "Return `tickets`: exactly one entry for every ticket above, by its",
    `\`number\`, and no other (at most ${MAX_HANDOFF_SCOUT_TICKETS}). Each entry has:`,
    "",
    `- \`filesToChange\`: empty for a ticket that changes no files, otherwise at most ${MAX_HANDOFF_SCOUT_FILES_TO_CHANGE} files the ticket may`,
    "  touch, each a `path` relative to the project root and a `change`.",
    "  `edit` is a file that exists and that you opened, or a file one of",
    "  this ticket's blockers marks as `create`, directly or through their",
    "  own blockers: the blocker lands first, so the file is there when this",
    "  ticket starts. `buildsOn` stays one entry per ticket in the Blocked by",
    "  line, whatever this ticket edits: when a direct blocker creates the",
    "  file and the file is what this ticket needs from it, that blocker's",
    "  single entry may give it as `createdPath`; never add a second entry",
    "  for the same blocker. A blocker further up the chain, one not in the",
    "  Blocked by line, gets no `buildsOn` entry at all.",
    "  `create` is a new",
    "  file: it must not exist yet, it must sit inside the project, and it",
    "  must not be in a folder the repository ignores. Only one ticket may",
    "  mark a path as `create`. When two tickets write the",
    "  same new file, such as a test file that one ticket adds and a later",
    "  one extends, the earlier ticket marks it `create` and the later one,",
    "  which must be blocked by it, marks it `edit`. Where the language",
    "  allows it, the later ticket may instead create a test file of its own",
    "  beside the blocker's: Go, for example, allows several `_test.go` files",
    "  in one package.",
    `- \`buildsOnFiles\`: at most ${MAX_HANDOFF_SCOUT_BUILDS_ON_FILES} citations of existing code the ticket`,
    "  builds on without changing it: the helpers, types and tables it uses.",
    "  Only code this ticket itself reads, calls or imports: leave out code",
    "  elsewhere in the system that this ticket never touches.",
    `- \`facts\`: at most ${MAX_HANDOFF_SCOUT_FACTS} facts about the code the ticket touches, each a`,
    "  one-sentence `statement` and the `citation` it was read at. When what",
    "  the code shows contradicts the ticket, the spec, or what a blocker is",
    "  scoped to provide, cite the whole type or declaration involved and",
    "  state what it holds, then name the consequence for this ticket as a",
    "  positive claim about that range — for example, \"the cited response",
    "  type declares only text/csv, so this ticket needs the blocker to",
    "  declare a 404.\" A statement about a whole file or component cites",
    "  the full range it describes, or it is split into facts that each",
    "  carry their own citation. A fact never says a field matches, holds or",
    "  maps to a column or field the spec asks for unless the cited code",
    "  shows it holds that data. When the spec asks for data the code does",
    "  not hold, use that same positive-claim form instead: cite the whole",
    "  type and state what it holds, then name the consequence for this",
    "  ticket.",
    ...exclusivityRule("A fact"),
    `- \`buildsOn\`: exactly one entry for every ticket in its Blocked by line`,
    `  (at most ${MAX_HANDOFF_SCOUT_BUILDS_ON}), and none for any other ticket. \`blocker\` is the`,
    "  blocking ticket's number; `provides` names what this ticket needs from",
    "  it (a file, a symbol, a table). When this ticket needs something its",
    "  blocker's ticket text does not promise, say so in `provides` too.",
    "  `check` is the command or test that proves it exists before work",
    "  starts. Say where it is in exactly one of three ways, and leave the",
    "  other fields null:",
    "  - It already exists in the code: give its `citation`.",
    "  - The blocker creates it: give the path in `createdPath`, which must be",
    "    one of that blocker's `create` files.",
    "  - The blocker adds it to a file it edits: give that file in",
    "    `editedPath`, which must be one of that blocker's `edit` files, and",
    "    name what it adds in `symbol`: a function, a route, a table, a field.",
    "    Do not cite nearby lines of that file instead: they exist today, so",
    "    they prove nothing about the blocker.",
    "  The `check` must fail until the blocker lands and pass once it has: a",
    "  grep for the symbol or the path, or a test that exercises it. A build or",
    "  a command that already passes on today's code proves nothing. A ticket",
    "  with no blockers has an empty list.",
    "  Every `check`, and every `provedBy.command`, runs from the repository",
    "  root. After a `cd`, paths are relative to the new directory: after",
    "  `cd backend`, write `export/export.go`, never `backend/export/export.go`.",
    "  Otherwise do not `cd`: name paths from the repository root.",
    "- `provedBy`: the `testPath` of the test file to add or extend,",
    "  relative to the project root, or null when the spec rules out",
    "  tests for this ticket's kind of change (see below). `command`",
    "  is the shell command that proves the ticket, in the form the",
    "  project already runs its tests.",
    "  The test file is one of this ticket's",
    "  own `filesToChange`, as a `create` or an `edit`: the ticket may",
    "  only write the files it lists.",
    "  Only a ticket that changes no files may name a test outside them.",
    "  `testPath` is a test in the project's own test",
    "  layout, never a source file the ticket changes.",
    "  When `testPath` names a test, `command` must run that test and",
    "  fail without this ticket's change; narrow it to that test file or",
    "  package where the project's runner allows one — a project-wide",
    "  command that runs every test is not a proof on its own.",
    "  For a ticket that changes files, when the spec does not rule",
    "  out tests for this kind of change and no existing test covers",
    "  its acceptance criteria, add one: list it as a `create` in",
    "  `filesToChange` and name it here as `testPath`. When",
    "  `testPath` is set, a ticket proved only by a build — codegen,",
    "  configuration — gives `command` as the build command followed",
    "  by the command that runs the test named in `testPath`, for",
    "  example `<build> && <test command>`, so `command` exercises",
    "  the test it names.",
    "  The proof must fail on the current commit, before this ticket's",
    "  change, and pass after it. A file the ticket edits is never its own",
    "  proof unless it is a test: a spec, a configuration file or a generated",
    "  file parses and builds today, so it proves nothing about the change.",
    "  Prove such a change with a test, or with a command that fails today: a",
    "  build, or a grep for what the ticket adds.",
    "  When the spec rules out tests for this ticket's kind of change, set",
    "  `testPath` to null and give as `command` a command over the ticket's",
    "  own files, such as a build or a grep, that fails on the current commit;",
    "  say in a fact that the spec excludes tests.",
    "  A ticket proved by a build builds the whole module or app, not only",
    "  the package it changes: `go build ./...`, not `go build ./export/...`.",
    "  When that build needs a change outside the ticket's files, such as a",
    "  stub for a method a regenerated interface gains, add that file to",
    "  `filesToChange` and say why in a fact.",
    "  When `testPath` is set, it must sit where the project's own test",
    "  command collects it: a runner config's include globs, the test",
    "  recipe in a justfile, Makefile or package.json, or the runner's",
    "  default discovery. You confirm this and state it in a fact,",
    "  citing the config or recipe line that collects it. With no",
    "  explicit include globs, cite the line that invokes the runner",
    '  (e.g. `package.json`\'s `"test": "vitest run"`) and name the',
    "  runner's default pattern in the fact's text. When no file",
    "  invokes the runner either, state the runner's default",
    "  discovery rule in the fact and cite an existing test file the",
    "  same runner already collects under the same pattern, as",
    "  evidence of that pattern. Never cite a line that neither",
    "  invokes the runner, configures what it collects, nor is such",
    "  a test file. This fact may cite a config, recipe, or existing",
    "  test file the ticket does not change, an exception to facts",
    "  being about the code the ticket touches. A path the runner",
    "  does not collect — a file under `scripts/` when the runner",
    "  only globs `src/**/*.test.ts` — is not a proof: pick a path",
    "  the runner collects.",
    "",
    ...CITATION_RULES,
    "Paths to create are checked too: a path outside the project, one that",
    "already exists, or one the repository ignores rejects the whole report.",
    "So does a dependency that names a path its blocker does not create or",
    "edit, a test that is not among its ticket's files to change, a proof",
    "by a file the ticket edits that is not a test by its name, and a check",
    "or command that names a path from the repository root after a `cd`.",
    renderRetryWithPreviousResult(request.rejectionReason, request.previousResult),
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
  if (request.kind === "scout-project") return buildScoutPrompt(request);
  if (request.kind === "handoff-scout") return buildHandoffScoutPrompt(request);

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
