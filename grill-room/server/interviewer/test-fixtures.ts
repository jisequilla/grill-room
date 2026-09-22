import type { FindSupersededResult, ProposeRoundResult } from "./schemas.js";
import type {
  DecisionSnapshot,
  FindSupersededRequest,
  InterviewContext,
  ProposeRoundRequest,
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
