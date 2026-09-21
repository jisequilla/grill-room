import { InterviewerError } from "./errors.js";
import { resultSchemas } from "./schemas.js";
import type { RequestKind, ResultFor } from "./schemas.js";
import type {
  BreakIntoTicketsRequest,
  Interviewer,
  InterviewerRequest,
  InterviewerTurn,
  ProposeRoundRequest,
  ReviewStaleRequest,
  SynthesizeSpecRequest,
} from "./types.js";

/** The conversation id the fake hands back when the session has none yet. */
export const FAKE_CONVERSATION_ID = "fake-conversation";

/** A well-formed turn. `result` is typed against the kind's schema. */
type ScriptedResult = {
  [Kind in RequestKind]: {
    kind: Kind;
    result: ResultFor<Kind>;
    conversationId?: string;
  };
}[RequestKind];

/** A turn whose output does not match the schema, to exercise the error path. */
interface ScriptedInvalidResult {
  kind: RequestKind;
  invalidResult: unknown;
  conversationId?: string;
}

/** A turn that fails, to exercise a typed error path. */
interface ScriptedError {
  kind: RequestKind;
  error: InterviewerError;
}

export type ScriptedTurn =
  | ScriptedResult
  | ScriptedInvalidResult
  | ScriptedError;

export interface FakeInterviewer extends Interviewer {
  /** Every request the fake was given, in order. */
  readonly requests: InterviewerRequest[];
  /** Appends turns to the queue mid-test. */
  push(...turns: ScriptedTurn[]): void;
  /** Turns still queued. */
  readonly remaining: number;
}

function isError(turn: ScriptedTurn): turn is ScriptedError {
  return "error" in turn;
}

/**
 * The scripted fake. It returns queued results in order, records what it was
 * asked, and validates every scripted payload against the same schema the real
 * adapter uses, so a fake turn can never be a shape the real one could not
 * produce. Running out of queued turns, or being asked for a kind the next
 * queued turn does not match, is a fault in the test rather than an interviewer
 * error, and is reported as a plain error.
 */
export function createFakeInterviewer(
  turns: ScriptedTurn[] = [],
): FakeInterviewer {
  const queue = [...turns];
  const requests: InterviewerRequest[] = [];

  // Like the real adapter, the payload is validated against
  // `resultSchemas[request.kind]`, which is what makes the cast at each method
  // below sound.
  function turn(request: InterviewerRequest): Promise<InterviewerTurn<unknown>> {
    requests.push(request);

    const next = queue.shift();
    if (!next) {
      return Promise.reject(
        new Error(
          `Fake interviewer: no queued turn for a "${request.kind}" request (${requests.length} requests so far). Script one.`,
        ),
      );
    }
    if (next.kind !== request.kind) {
      return Promise.reject(
        new Error(
          `Fake interviewer: next queued turn is "${next.kind}" but the request was "${request.kind}".`,
        ),
      );
    }

    if (isError(next)) return Promise.reject(next.error);

    const payload = "result" in next ? next.result : next.invalidResult;
    const parsed = resultSchemas[request.kind].safeParse(payload);
    if (!parsed.success) {
      return Promise.reject(
        new InterviewerError(
          "malformed-output",
          "The interviewer returned a result that does not match the expected shape.",
          JSON.stringify(parsed.error.issues).slice(0, 2000),
        ),
      );
    }

    return Promise.resolve({
      result: parsed.data,
      conversationId:
        next.conversationId ??
        request.context.conversationId ??
        FAKE_CONVERSATION_ID,
    });
  }

  return {
    requests,
    get remaining() {
      return queue.length;
    },
    push(...more: ScriptedTurn[]) {
      queue.push(...more);
    },
    proposeRound: (request: ProposeRoundRequest) =>
      turn(request) as Promise<InterviewerTurn<ResultFor<"propose-round">>>,
    reviewStale: (request: ReviewStaleRequest) =>
      turn(request) as Promise<InterviewerTurn<ResultFor<"review-stale">>>,
    synthesizeSpec: (request: SynthesizeSpecRequest) =>
      turn(request) as Promise<InterviewerTurn<ResultFor<"synthesize-spec">>>,
    breakIntoTickets: (request: BreakIntoTicketsRequest) =>
      turn(request) as Promise<
        InterviewerTurn<ResultFor<"break-into-tickets">>
      >,
  };
}

/**
 * A minimal complete interview: one round of two questions, then a proposal
 * that we are done, then a spec and its tickets. It is what the fake serves
 * when it is selected by environment variable rather than scripted by a test,
 * so the browser smoke test has an interview to walk through.
 */
export function cannedInterviewTurns(): ScriptedTurn[] {
  return [
    {
      kind: "propose-round",
      result: {
        proposedDecisions: [
          {
            key: "shape",
            title: "What shape should this take?",
            body: "The first thing to settle is the overall shape.",
            choices: ["A single page", "A workspace"],
            recommendedAnswer: "A workspace",
            dependsOn: [],
            ask: true,
          },
          {
            key: "storage",
            title: "Where does the data live?",
            body: "Storage follows from the shape.",
            choices: ["In memory", "On disk"],
            recommendedAnswer: "On disk",
            dependsOn: [],
            ask: true,
          },
        ],
        pushBackResponses: [],
        userDecisionPlacements: [],
        done: null,
      },
    },
    {
      kind: "propose-round",
      result: {
        proposedDecisions: [],
        pushBackResponses: [],
        userDecisionPlacements: [],
        done: {
          summary:
            "Settled: the shape is a workspace, and its data lives on disk.",
        },
      },
    },
    {
      kind: "synthesize-spec",
      result: {
        markdown: [
          "## Problem Statement",
          "",
          "A canned spec, produced by the fake interviewer.",
          "",
          "## Solution",
          "",
          "A workspace whose data lives on disk.",
          "",
          "## User Stories",
          "",
          "1. As a user, I want a workspace, so that I can see the whole shape of what I am deciding.",
          "",
          "## Implementation Decisions",
          "",
          "- The shape is a workspace.",
          "- The data lives on disk.",
          "",
          "## Testing Decisions",
          "",
          "- Behaviour is tested at the action boundary.",
          "",
          "## Out of Scope",
          "",
          "- Anything not decided above.",
          "",
          "## Further Notes",
          "",
          "- This spec came from the fake interviewer.",
        ].join("\n"),
      },
    },
    {
      kind: "break-into-tickets",
      result: {
        tickets: [
          {
            number: 1,
            slug: "build-the-workspace",
            title: "Build the workspace",
            body: "Build the workspace shell.",
            blockedBy: [],
          },
          {
            number: 2,
            slug: "store-on-disk",
            title: "Store the data on disk",
            body: "Persist the workspace's data.",
            blockedBy: [1],
          },
        ],
      },
    },
  ];
}
