import type { HandoffFactPack } from "../handoff-fact-pack.js";
import type {
  AssessReadinessEvidenceItem,
  AssessReadinessResult,
  FindSupersededResult,
  HandoffScoutResult,
  ProposeRoundResult,
  ScoutProjectResult,
  SharpenCardsResult,
  SharpenRewriteResult,
} from "./schemas.js";
import type {
  AssessReadinessRequest,
  DecisionSnapshot,
  FindSupersededRequest,
  HandoffScoutRequest,
  InterviewContext,
  ProposeRoundRequest,
  ProjectServerFacts,
  ScoutProjectRequest,
  ScoutReportForReadiness,
  SharpenCardsRequest,
  SharpeningRoundForPrompt,
  SharpenRewriteRequest,
  SynthesizeSpecRequest,
} from "./types.js";

/**
 * Request and result builders for tests. Every field has a defensible default,
 * so a test states only what it is actually about. Shared with the action tests
 * of later tickets, which script the fake interviewer with these results.
 */

export function aDecision(
  overrides: Partial<DecisionSnapshot> = {},
): DecisionSnapshot {
  return {
    key: "shape",
    title: "What shape should this take?",
    body: "The first thing to settle.",
    choices: [],
    recommendedChoice: null,
    recommendedAnswer: "A workspace",
    dependsOn: [],
    state: "frontier",
    answer: null,
    previousAnswers: [],
    introducedBy: "interviewer",
    repo: null,
    ...overrides,
  };
}

export function aContext(
  overrides: Partial<InterviewContext> = {},
): InterviewContext {
  return {
    sessionId: "session-1",
    idea: "A local app that grills me about an idea until it is decided.",
    title: "Grill Room",
    model: "sonnet",
    answeringMode: "whole-round",
    conversationId: null,
    docsFolder: null,
    decisions: [],
    projectContext: null,
    ...overrides,
  };
}

export function aProposeRoundRequest(
  overrides: Partial<ProposeRoundRequest> = {},
): ProposeRoundRequest {
  return {
    kind: "propose-round",
    context: aContext(),
    latestAnswers: [],
    userAddedDecisions: [],
    rejectionReason: null,
    ...overrides,
  };
}

export function aFindSupersededRequest(
  overrides: Partial<FindSupersededRequest> = {},
): FindSupersededRequest {
  return {
    kind: "find-superseded",
    context: aContext(),
    looseEndKeys: ["storage"],
    replaceableKeys: [],
    laterKeys: {},
    deferrableKeys: [],
    restatableKeys: [],
    rejectionReason: null,
    ...overrides,
  };
}

export function aSynthesizeSpecRequest(
  overrides: Partial<SynthesizeSpecRequest> = {},
): SynthesizeSpecRequest {
  return {
    kind: "synthesize-spec",
    context: aContext(),
    outOfScope: [],
    openQuestions: [],
    reopenedRepoDecisions: [],
    rejectionReason: null,
    ...overrides,
  };
}

export function aProposeRoundResult(
  overrides: Partial<ProposeRoundResult> = {},
): ProposeRoundResult {
  return {
    proposedDecisions: [
      {
        key: "shape",
        title: "What shape should this take?",
        body: "The first thing to settle.",
        choices: [
          { label: "A single page", rationale: "Cheapest, and it hides the tree." },
          { label: "A workspace", rationale: "More layout, and the tree stays visible." },
        ],
        recommendedChoice: 1,
        recommendedAnswer: "A workspace",
        dependsOn: [],
        ask: true,
        adrWorthy: false,
        consequences: null,
      },
    ],
    pushBackResponses: [],
    userDecisionPlacements: [],
    done: null,
    ...overrides,
  };
}

export function aFindSupersededResult(
  overrides: Partial<FindSupersededResult> = {},
): FindSupersededResult {
  return {
    supersessions: [
      {
        looseEndKey: "storage",
        answeredByKey: "shape",
        answer: "On disk",
        reason: "The workspace decision already commits to a database on disk.",
      },
    ],
    replacements: [],
    restatements: [],
    deferrals: [],
    ...overrides,
  };
}

export function anAssessReadinessRequest(
  overrides: Partial<Omit<AssessReadinessRequest, "kind">> = {},
): AssessReadinessRequest {
  return {
    kind: "assess-readiness",
    context: aContext({ decisions: [] }),
    scoutReport: null,
    rejectionReason: null,
    previousResult: null,
    ...overrides,
  };
}

/** An idea-sourced evidence item, quoted in the idea's own words. */
export function ideaEvidence(text: string): AssessReadinessEvidenceItem {
  return { text, source: "idea", citation: null };
}

/** A repo-sourced evidence item, citing where in the project it was read. */
export function repoEvidence(
  text: string,
  citation: string,
): AssessReadinessEvidenceItem {
  return { text, source: "repo", citation };
}

/** The session's current scout report, as the readiness judge would read it. */
export function aScoutReportForReadiness(
  overrides: Partial<ScoutReportForReadiness> = {},
): ScoutReportForReadiness {
  return {
    currentState: [
      {
        status: "partial",
        summary: "Ingest lag is measured but never alerted on.",
        citations: ["src/ingest/metrics.ts:12-30"],
      },
    ],
    proposedDecisions: [
      {
        key: "no-message-broker",
        title: "No message broker",
        statement: "Ingest runs on a Postgres-backed queue, not a message broker.",
        source: "recorded",
        citation: "docs/adr/0003-queue.md:5-9",
        reason: "An alert on ingest lag reads the queue this decision chose.",
        disposition: "undecided",
      },
    ],
    commitRead: "c2167ed4b1f0a9e8d7c6b5a4f3e2d1c0b9a8f7e6",
    stale: false,
    ...overrides,
  };
}

export function someProjectServerFacts(
  overrides: Partial<ProjectServerFacts> = {},
): ProjectServerFacts {
  return {
    headCommit: "c2167ed4b1f0a9e8d7c6b5a4f3e2d1c0b9a8f7e6",
    headBranch: "main",
    remotes: [
      { name: "origin", url: "git@github.com:someone/observability.git", type: "fetch" },
      { name: "origin", url: "git@github.com:someone/observability.git", type: "push" },
    ],
    dirty: false,
    recentCommitSubjects: ["Add the ingest queue", "Record the broker decision"],
    hasAgentInstructions: true,
    decisionsFolder: "docs/adr",
    hasRulesFolder: false,
    decisionFiles: [],
    adrConvention: null,
    ...overrides,
  };
}

export function aScoutProjectRequest(
  overrides: Partial<Omit<ScoutProjectRequest, "kind">> = {},
): ScoutProjectRequest {
  return {
    kind: "scout-project",
    context: aContext({
      idea: "Alert the on-call engineer when ingest falls behind.",
      title: "Ingest lag alerts",
    }),
    projectRoot: "/Users/someone/projects/observability",
    facts: someProjectServerFacts(),
    previousDecisions: [],
    rejectionReason: null,
    previousResult: null,
    ...overrides,
  };
}

export function aScoutProjectResult(
  overrides: Partial<ScoutProjectResult> = {},
): ScoutProjectResult {
  return {
    currentState: [
      {
        status: "partial",
        summary: "Ingest lag is measured but never alerted on.",
        citations: ["src/ingest/metrics.ts:12-30"],
      },
    ],
    proposedDecisions: [
      {
        key: "no-message-broker",
        title: "No message broker",
        statement: "Ingest runs on a Postgres-backed queue, not a message broker.",
        source: "recorded",
        citation: "docs/adr/0003-queue.md:5-9",
        reason: "An alert on ingest lag reads the queue this decision chose.",
      },
    ],
    previousDecisions: [],
    ...overrides,
  };
}

export function anAssessReadinessResult(
  overrides: Partial<AssessReadinessResult> = {},
): AssessReadinessResult {
  return {
    evidence: [ideaEvidence("A local app that grills me about an idea")],
    objective: "A local app that interviews the user until an idea is decided.",
    objectiveIsProcess: false,
    expectedOutcome: "A settled set of decisions for the idea.",
    unknowns: ["Where the sessions are stored"],
    verdict: "ready",
    missing: [],
    ...overrides,
  };
}

export const NO_DELEGATION_PROPOSALS: HandoffScoutResult["delegationProposals"] = {
  maxTicketsInFlight: null,
  pruneCommand: null,
  reviewRule: null,
  preflight: null,
};

export function someHandoffFactPack(
  overrides: Partial<HandoffFactPack> = {},
): HandoffFactPack {
  return {
    trackedFiles: [],
    trackedFilesOmitted: 0,
    namedDocs: [],
    ruleSources: [],
    verifyCommand: null,
    ...overrides,
  };
}

export function aHandoffScoutRequest(
  overrides: Partial<Omit<HandoffScoutRequest, "kind">> = {},
): HandoffScoutRequest {
  return {
    kind: "handoff-scout",
    context: aContext({
      idea: "Alert the on-call engineer when ingest falls behind.",
      title: "Ingest lag alerts",
    }),
    projectRoot: "/Users/someone/projects/observability",
    facts: someProjectServerFacts(),
    factPack: someHandoffFactPack(),
    specMarkdown:
      "## Problem Statement\n\nNobody is told when ingest falls behind.",
    tickets: [
      {
        number: 1,
        title: "Measure the lag alert threshold",
        body: "Add a lag alert beside the ingest metrics.",
        blockedBy: [],
      },
      {
        number: 2,
        title: "Page the on-call engineer",
        body: "Wire the lag alert into the ingest queue.",
        blockedBy: [1],
      },
    ],
    rejectionReason: null,
    previousResult: null,
    ...overrides,
  };
}

/** A grounding of {@link aHandoffScoutRequest}'s two tickets. */
export function aHandoffScoutResult(
  overrides: Partial<HandoffScoutResult> = {},
): HandoffScoutResult {
  return {
    tickets: [
      {
        number: 1,
        filesToChange: [
          { path: "src/ingest/lag-alert.ts", change: "create" },
          { path: "src/ingest/lag-alert.test.ts", change: "create" },
          { path: "src/ingest/metrics.ts", change: "edit" },
        ],
        reach: [],
        buildsOnFiles: ["src/ingest/metrics.ts:12-30"],
        facts: [
          {
            statement: "Ingest lag is measured in src/ingest/metrics.ts.",
            citation: "src/ingest/metrics.ts:12-30",
          },
        ],
        buildsOn: [],
        rules: [],
        twoLensReview: null,
        provedBy: {
          testPath: "src/ingest/lag-alert.test.ts",
          command: "npm test -- lag-alert",
        },
      },
      {
        number: 2,
        filesToChange: [
          { path: "src/ingest/queue.ts", change: "edit" },
          { path: "src/ingest/queue.test.ts", change: "create" },
        ],
        reach: [],
        buildsOnFiles: ["docs/adr/0003-queue.md:5-9"],
        facts: [],
        buildsOn: [
          {
            blocker: 1,
            provides: "The lag alert module.",
            citation: null,
            createdPath: "src/ingest/lag-alert.ts",
            editedPath: null,
            symbol: null,
            check: "test -f src/ingest/lag-alert.ts",
          },
        ],
        rules: [],
        twoLensReview: null,
        provedBy: {
          testPath: "src/ingest/queue.test.ts",
          command: "npm test -- queue",
        },
      },
    ],
    delegationProposals: NO_DELEGATION_PROPOSALS,
    ...overrides,
  };
}

/** An earlier sharpening round: one card accepted on its recommendation, one answered `I don't know`, then an accepted idea readiness still judged not ready. */
export function aSharpeningRound(
  overrides: Partial<SharpeningRoundForPrompt> = {},
): SharpeningRoundForPrompt {
  return {
    number: 1,
    cards: [
      {
        key: "sharpen-what",
        direction: "what",
        title: "What gets built?",
        answerKind: "accepted-recommendation",
        answer: "A scoring sheet for the repos",
      },
      {
        key: "sharpen-who",
        direction: "who",
        title: "Who uses it?",
        answerKind: "unknown",
        answer: "",
      },
    ],
    acceptedIdea: "Build a scoring sheet to compare eight repos.",
    edited: false,
    verdict: "not-ready",
    missing: ["What the sheet scores"],
    ...overrides,
  };
}

/** The not-ready verdict a sharpening round answers: its two missing items match no earlier round's. */
export function aNotReadyVerdict(
  overrides: Partial<AssessReadinessResult> = {},
): AssessReadinessResult {
  return anAssessReadinessResult({
    evidence: [],
    objective: null,
    objectiveIsProcess: true,
    expectedOutcome: null,
    unknowns: ["What would actually get built", "Who the comparison is for"],
    verdict: "not-ready",
    missing: ["A single buildable thing, not a method", "Who the result is for"],
    ...overrides,
  });
}

/**
 * A first-round request for direction cards. The current idea differs from
 * the idea as first written, and `usedKeys` holds the tree's one key.
 */
export function aSharpenCardsRequest(
  overrides: Partial<Omit<SharpenCardsRequest, "kind">> = {},
): SharpenCardsRequest {
  return {
    kind: "sharpen-cards",
    context: aContext({
      idea: "Build something to compare eight repos.",
      title: "Repo comparison",
      decisions: [aDecision({ key: "repo-db", state: "settled" })],
    }),
    originalIdea: "Decide how to evaluate eight repos.",
    readiness: aNotReadyVerdict(),
    rounds: [],
    usedKeys: ["repo-db"],
    rejectionReason: null,
    previousResult: null,
    ...overrides,
  };
}

/**
 * A rewrite request for a round whose cards are `what` (accepted on its
 * recommendation), `who` (`I don't know`) and `outcome` (an own answer).
 */
export function aSharpenRewriteRequest(
  overrides: Partial<Omit<SharpenRewriteRequest, "kind">> = {},
): SharpenRewriteRequest {
  return {
    kind: "sharpen-rewrite",
    context: aContext({
      idea: "Decide how to evaluate eight repos.",
      title: "Repo comparison",
      decisions: [aDecision({ key: "repo-db", state: "settled" })],
    }),
    originalIdea: "Decide how to evaluate repos.",
    readiness: aNotReadyVerdict(),
    rounds: [],
    answers: [
      {
        key: "what",
        title: "What gets built?",
        kind: "accepted-recommendation",
        text: "A training plan tracker",
      },
      { key: "who", title: "Who uses it?", kind: "unknown", text: "" },
      {
        key: "outcome",
        title: "What exists when it is done?",
        kind: "own-answer",
        text: "My club follows its plans week by week",
      },
    ],
    rejectionReason: null,
    previousResult: null,
    ...overrides,
  };
}

/** One direction card, with two choices and the first recommended. */
export function aSharpeningCard(
  key: string,
  overrides: Partial<SharpenCardsResult["cards"][number]> = {},
): SharpenCardsResult["cards"][number] {
  return {
    key,
    direction: "constraint",
    title: `Question ${key}?`,
    body: `Why ${key} matters.`,
    choices: [
      { label: "One", rationale: "The first option." },
      { label: "Two", rationale: "The second option." },
    ],
    recommendedChoice: 0,
    recommendedAnswer: "The first option is smaller.",
    ...overrides,
  };
}

/** A first round's cards, one per direction it must ask. */
export function aSharpenCardsResult(
  overrides: Partial<SharpenCardsResult> = {},
): SharpenCardsResult {
  return {
    cards: [
      aSharpeningCard("sharpen-what", { direction: "what" }),
      aSharpeningCard("sharpen-who", { direction: "who" }),
      aSharpeningCard("sharpen-outcome", { direction: "outcome" }),
    ],
    ...overrides,
  };
}

/** A rewrite of {@link aSharpenRewriteRequest}'s round, using its two settling answers. */
export function aSharpenRewriteResult(
  overrides: Partial<SharpenRewriteResult> = {},
): SharpenRewriteResult {
  return {
    idea: "A tracker for my club's training plans.",
    uses: [
      { cardKey: "what", how: "Names the tracker as the thing to build." },
      { cardKey: "outcome", how: "Says the club follows its plans with it." },
    ],
    note: "Named the tracker and what it is for.",
    ...overrides,
  };
}
