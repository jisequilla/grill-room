import type { ProposeRoundResult } from "./schemas.js";
import type {
  DecisionSnapshot,
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
        choices: ["A single page", "A workspace"],
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
