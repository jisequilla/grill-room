import { InterviewerError } from "./errors.js";
import { observeCall, schemaIssuesReason, type CallResult } from "./observe.js";
import { resultSchemas } from "./schemas.js";
import type { RequestKind, ResultFor } from "./schemas.js";
import type {
  AssessReadinessRequest,
  BreakIntoTicketsRequest,
  FindSupersededRequest,
  Interviewer,
  InterviewerRequest,
  InterviewerTurn,
  ModelCallObserver,
  ProposeRoundRequest,
  ReviewStaleRequest,
  SynthesizeSpecRequest,
} from "./types.js";

/** The conversation id the fake hands back when the session has none yet. */
export const FAKE_CONVERSATION_ID = "fake-conversation";

interface ScriptedTurnBase {
  /**
   * Resuming the session's conversation fails first, as the real adapter sees
   * it: the observer hears a `resume-fallback` call, then this turn is served
   * as the call of a fresh, primed conversation. `true` uses a default reason;
   * a string is the reason. Only valid for a request that resumes a
   * conversation, as with the real adapter.
   */
  resumeFallback?: true | string;
}

/** A well-formed turn. `result` is typed against the kind's schema. */
export type ScriptedResult = {
  [Kind in RequestKind]: ScriptedTurnBase & {
    kind: Kind;
    result: ResultFor<Kind>;
    conversationId?: string;
  };
}[RequestKind];

/** A turn whose output does not match the schema, to exercise the error path. */
export interface ScriptedInvalidResult extends ScriptedTurnBase {
  kind: RequestKind;
  invalidResult: unknown;
  conversationId?: string;
}

/** A turn that fails, to exercise a typed error path. */
export interface ScriptedError extends ScriptedTurnBase {
  kind: RequestKind;
  error: InterviewerError;
}

export type ScriptedTurn =
  | ScriptedResult
  | ScriptedInvalidResult
  | ScriptedError;

const DEFAULT_RESUME_FAILURE =
  "The interviewer turn failed (exit code 1): no conversation found to resume.";

/** A turn the shared subscription pool refuses. Reported as a rate limit, never an interviewer error. */
export function rateLimitedTurn(
  kind: RequestKind,
  message = "The Claude subscription is rate limited right now. This is not an interviewer failure: wait and retry the turn.",
): ScriptedError {
  return { kind, error: new InterviewerError("rate-limited", message) };
}

/** A turn whose output fails the kind's schema. Anything not matching it will do. */
export function schemaInvalidTurn(
  kind: RequestKind,
  invalidResult: unknown = { unexpected: true },
): ScriptedInvalidResult {
  return { kind, invalidResult };
}

/** The same turn, served only after resuming the conversation failed. */
export function withResumeFallback<Turn extends ScriptedTurn>(
  turn: Turn,
  reason: true | string = true,
): Turn {
  return { ...turn, resumeFallback: reason };
}

type ProposedDecision = ResultFor<"propose-round">["proposedDecisions"][number];

function aProposedDecision(
  key: string,
  overrides: Partial<ProposedDecision> = {},
): ProposedDecision {
  return {
    key,
    title: `Question ${key}?`,
    body: `Why ${key} matters.`,
    choices: [],
    recommendedChoice: null,
    recommendedAnswer: "",
    dependsOn: [],
    ask: true,
    ...overrides,
  };
}

function aRound(
  proposedDecisions: ProposedDecision[],
  extra: Partial<ResultFor<"propose-round">> = {},
): ResultFor<"propose-round"> {
  return {
    proposedDecisions,
    pushBackResponses: [],
    userDecisionPlacements: [],
    done: null,
    ...extra,
  };
}

/**
 * Round proposals that pass the schema but break one tree rule each, so the
 * app refuses them. Script one as `{ kind: "propose-round", result }`. Each
 * is refused against any tree, except where it names what it needs from it.
 */
export const treeRuleViolation = {
  /** Asks a question that depends on another asked in the same round, so it is not on the frontier. */
  offFrontier: (): ResultFor<"propose-round"> =>
    aRound([
      aProposedDecision("fake-first"),
      aProposedDecision("fake-off-frontier", { dependsOn: ["fake-first"] }),
    ]),
  /** Depends on a key that is neither in the tree nor in the proposal. */
  unknownKey: (
    missingKey = "fake-no-such-decision",
  ): ResultFor<"propose-round"> =>
    aRound([aProposedDecision("fake-dangling", { dependsOn: [missingKey] })]),
  /** Two new decisions that depend on each other. */
  cycle: (): ResultFor<"propose-round"> =>
    aRound([
      aProposedDecision("fake-cycle-a", {
        dependsOn: ["fake-cycle-b"],
        ask: false,
      }),
      aProposedDecision("fake-cycle-b", {
        dependsOn: ["fake-cycle-a"],
        ask: false,
      }),
    ]),
  /** Answers a push back by replacing the decision with the same question, unchanged. */
  unchangedReAsk: (pushedBack: {
    key: string;
    title: string;
    body: string;
  }): ResultFor<"propose-round"> =>
    aRound(
      [
        aProposedDecision("fake-re-ask", {
          title: pushedBack.title,
          body: pushedBack.body,
        }),
      ],
      {
        pushBackResponses: [
          {
            decisionKey: pushedBack.key,
            response: "replace",
            explanation: "Asking it again.",
            replacementKey: "fake-re-ask",
          },
        ],
      },
    ),
  /** Proposes, under a new key, a question already in the tree. */
  duplicateTitle: (existingTitle: string): ResultFor<"propose-round"> =>
    aRound([aProposedDecision("fake-duplicate", { title: existingTitle })]),
};

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
 *
 * Given an observer, it reports each scripted turn as the real adapter would:
 * one call, or a `resume-fallback` call followed by the turn's own call when
 * the turn is scripted with `resumeFallback`.
 */
export function createFakeInterviewer(
  turns: ScriptedTurn[] = [],
): FakeInterviewer {
  const queue = [...turns];
  const requests: InterviewerRequest[] = [];

  // Like the real adapter, the payload is validated against
  // `resultSchemas[request.kind]`, which is what makes the cast at each method
  // below sound.
  function serve(
    next: ScriptedTurn,
    request: InterviewerRequest,
    fellBack: boolean,
  ): Promise<CallResult<unknown>> {
    if (isError(next)) return Promise.reject(next.error);

    const payload = "result" in next ? next.result : next.invalidResult;
    const rawOutput = JSON.stringify(payload ?? null);
    const parsed = resultSchemas[request.kind].safeParse(payload);
    if (!parsed.success) {
      return Promise.reject(
        new InterviewerError(
          "malformed-output",
          "The interviewer returned a result that does not match the expected shape.",
          JSON.stringify(parsed.error.issues).slice(0, 2000),
          { rawOutput, reason: schemaIssuesReason(parsed.error.issues) },
        ),
      );
    }

    return Promise.resolve({
      turn: {
        result: parsed.data,
        // A fallback is a fresh conversation, so it never keeps the old id.
        conversationId:
          next.conversationId ??
          (fellBack ? null : request.context.conversationId) ??
          FAKE_CONVERSATION_ID,
      },
      rawOutput,
    });
  }

  async function turn(
    request: InterviewerRequest,
    observer: ModelCallObserver | undefined,
  ): Promise<InterviewerTurn<unknown>> {
    requests.push(request);

    const next = queue.shift();
    if (!next) {
      throw new Error(
        `Fake interviewer: no queued turn for a "${request.kind}" request (${requests.length} requests so far). Script one.`,
      );
    }
    if (next.kind !== request.kind) {
      throw new Error(
        `Fake interviewer: next queued turn is "${next.kind}" but the request was "${request.kind}".`,
      );
    }

    const resumes = request.context.conversationId != null;
    if (next.resumeFallback && !resumes) {
      throw new Error(
        `Fake interviewer: the queued "${next.kind}" turn scripts a resume fallback, but the request has no conversation to resume.`,
      );
    }

    if (next.resumeFallback) {
      const lost = new InterviewerError(
        "failed",
        next.resumeFallback === true ? DEFAULT_RESUME_FAILURE : next.resumeFallback,
      );
      try {
        await observeCall(
          observer,
          { requestKind: request.kind, call: 1, conversation: "resumed" },
          () => Promise.reject(lost),
          () => true,
        );
      } catch (error) {
        if (error !== lost) throw error;
      }
      return observeCall(
        observer,
        {
          requestKind: request.kind,
          call: 2,
          conversation: "primed-after-resume",
        },
        () => serve(next, request, true),
      );
    }

    return observeCall(
      observer,
      {
        requestKind: request.kind,
        call: 1,
        conversation: resumes ? "resumed" : "new",
      },
      () => serve(next, request, false),
    );
  }

  return {
    requests,
    get remaining() {
      return queue.length;
    },
    push(...more: ScriptedTurn[]) {
      queue.push(...more);
    },
    proposeRound: (request: ProposeRoundRequest, observer?: ModelCallObserver) =>
      turn(request, observer) as Promise<
        InterviewerTurn<ResultFor<"propose-round">>
      >,
    reviewStale: (request: ReviewStaleRequest, observer?: ModelCallObserver) =>
      turn(request, observer) as Promise<
        InterviewerTurn<ResultFor<"review-stale">>
      >,
    findSuperseded: (
      request: FindSupersededRequest,
      observer?: ModelCallObserver,
    ) =>
      turn(request, observer) as Promise<
        InterviewerTurn<ResultFor<"find-superseded">>
      >,
    synthesizeSpec: (
      request: SynthesizeSpecRequest,
      observer?: ModelCallObserver,
    ) =>
      turn(request, observer) as Promise<
        InterviewerTurn<ResultFor<"synthesize-spec">>
      >,
    breakIntoTickets: (
      request: BreakIntoTicketsRequest,
      observer?: ModelCallObserver,
    ) =>
      turn(request, observer) as Promise<
        InterviewerTurn<ResultFor<"break-into-tickets">>
      >,
    assessReadiness: (
      request: AssessReadinessRequest,
      observer?: ModelCallObserver,
    ) =>
      turn(request, observer) as Promise<
        InterviewerTurn<ResultFor<"assess-readiness">>
      >,
  };
}

/**
 * A minimal complete interview: one round of two questions, then a proposal
 * that we are done, the supersession check that follows it, then a spec and
 * its tickets. It is what the fake serves
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
            choices: [
              {
                label: "A single page",
                rationale:
                  "Everything in one scroll, nothing to navigate. Cheapest to build, but the tree and the round compete for the same space.",
              },
              {
                label: "A workspace",
                rationale:
                  "Round, tree and history each get their own column. More layout to get right, and the whole shape of the session stays visible.",
              },
            ],
            recommendedChoice: 1,
            recommendedAnswer:
              "The workspace, because seeing the tree beside the question is the thing a chat window cannot do.",
            dependsOn: [],
            ask: true,
          },
          {
            key: "storage",
            title: "Where does the data live?",
            body: "Storage follows from the shape.",
            choices: [
              {
                label: "In memory",
                rationale:
                  "No schema, no migrations, instant reads. A reload loses the session, which is fatal for an interview that runs for an hour.",
              },
              {
                label: "On disk",
                rationale:
                  "Survives a reload and a restart, and the session can be read back by other tools. Costs a schema and migrations from day one.",
              },
            ],
            recommendedChoice: 1,
            recommendedAnswer:
              "On disk: an interview that cannot survive a reload is not one anybody will finish.",
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
      // The done proposal's second half. The canned session's one loose end is
      // not answered anywhere else in the tree, so nothing is superseded and
      // the user resolves it by hand, exactly as before this turn existed.
      kind: "find-superseded",
      result: { supersessions: [] },
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
