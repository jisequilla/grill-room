import type {
  AssessReadinessResult,
  FindSupersededResult,
  ProposeRoundResult,
  ScoutProjectResult,
} from "./schemas.js";
import type {
  AssessReadinessRequest,
  DecisionSnapshot,
  FindSupersededRequest,
  InterviewContext,
  ProposeRoundRequest,
  ProjectServerFacts,
  ScoutProjectRequest,
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
    ...overrides,
  };
}

export function anAssessReadinessRequest(
  overrides: Partial<Omit<AssessReadinessRequest, "kind">> = {},
): AssessReadinessRequest {
  return {
    kind: "assess-readiness",
    context: aContext({ decisions: [] }),
    rejectionReason: null,
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
    evidence: ["A local app that grills me about an idea"],
    objective: "A local app that interviews the user until an idea is decided.",
    objectiveIsProcess: false,
    expectedOutcome: "A settled set of decisions for the idea.",
    unknowns: ["Where the sessions are stored"],
    verdict: "ready",
    missing: [],
    ...overrides,
  };
}
