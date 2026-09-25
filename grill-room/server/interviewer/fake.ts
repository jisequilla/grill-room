import { DEMO_SCENARIO, loadDemoScenario } from "./demo-scenario.js";
import { InterviewerError } from "./errors.js";
import { observeCall, schemaIssuesReason, type CallResult } from "./observe.js";
import { resultSchemas } from "./schemas.js";
import type { RequestKind, ResultFor } from "./schemas.js";
import type {
  AssessReadinessRequest,
  BreakIntoTicketsRequest,
  FindSupersededRequest,
  HandoffScoutRequest,
  Interviewer,
  InterviewerRequest,
  InterviewerTurn,
  ModelCallObserver,
  ProposeRoundRequest,
  ReviewStaleRequest,
  ScoutProjectRequest,
  SynthesizeSpecRequest,
} from "./types.js";
import { isProjectScoutRequest } from "./types.js";

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

/** The conversation a request resumes. A scout never resumes one, as with the real adapter. */
function conversationOf(request: InterviewerRequest): string | null {
  return isProjectScoutRequest(request) ? null : request.context.conversationId;
}

/**
 * A named script for the fake: the turns a session is served, in order, and
 * how long each answer takes. The delay runs inside the model call, so the
 * attempt log shows the call running for that long.
 */
export interface Scenario {
  turns: ScriptedTurn[];
  delayMs?: number;
}

/** The scenario a session gets when none was chosen for it. */
export const DEFAULT_SCENARIO = "canned-interview";

/**
 * The recorded demo session (see `demo-scenario.ts`), loaded once from
 * `e2e/fixtures/demo-recording.jsonl` when that fixture is present.
 * `loadDemoScenario` returns null rather than throwing when it is missing,
 * so a build that does not ship `e2e/` boots normally with one fewer
 * scenario rather than failing.
 */
const demoScenario = loadDemoScenario();

/**
 * Every scenario the fake can serve, by name. A plain map: add a scenario by
 * adding an entry. The app's fake builds each session's queue from here.
 */
export const fakeScenarios: Record<string, Scenario> = {
  [DEFAULT_SCENARIO]: { turns: cannedInterviewTurns() },
  "readiness-ready": { turns: readinessReadyTurns() },
  "readiness-not-ready": { turns: readinessNotReadyTurns() },
  "reopen-stale-review": { turns: reopenStaleReviewTurns() },
  supersession: { turns: supersessionTurns() },
  "refusal-then-success": { turns: refusalThenSuccessTurns() },
  // Long enough to see the turn running before it fails, and again before the
  // manual retry succeeds — with enough margin that a slow machine (several
  // worktrees' browsers running at once) still catches the running state
  // before it lands, rather than racing the workspace's 500 ms poll.
  "rate-limit-then-retry": { turns: rateLimitThenRetryTurns(), delayMs: 5_000 },
  "scout-project": { turns: scoutProjectTurns() },
  "scout-project-readiness": { turns: scoutProjectReadinessTurns() },
  "handoff-scout": { turns: handoffScoutTurns() },
  ...(demoScenario ? { [DEMO_SCENARIO]: demoScenario } : {}),
};

/** Whether the registry has a scenario of that name. */
export function isFakeScenario(name: string): boolean {
  return Object.prototype.hasOwnProperty.call(fakeScenarios, name);
}

/**
 * The fake the app serves when it is selected by environment variable: one
 * queue per session, so sessions never consume each other's turns.
 */
export interface ScenarioInterviewer extends Interviewer {
  /** Every request the fake was given, across every session, in order. */
  readonly requests: InterviewerRequest[];
  /**
   * Serves the session from the named scenario, from the start, replacing any
   * queue the session already has. Throws for a name not in the registry.
   */
  useScenario(sessionId: string, name: string): void;
  /** Turns still queued for the session, or null before its queue exists. */
  remainingFor(sessionId: string): number | null;
}

/** Where a scripted fake takes each request's turn from. */
interface TurnSource {
  /** Removes and returns the next turn for the request, if there is one. */
  take(request: InterviewerRequest): ScriptedTurn | undefined;
  /** Names the queue the request was served from, for fault messages. */
  queueName(request: InterviewerRequest): string;
  /** How long to wait before answering the request. */
  delayMs(request: InterviewerRequest): number;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
 *
 * Every session shares the one queue. The app's fake, which keeps a queue per
 * session, is {@link createScenarioInterviewer}.
 */
export function createFakeInterviewer(
  turns: ScriptedTurn[] = [],
): FakeInterviewer {
  const queue = [...turns];
  const requests: InterviewerRequest[] = [];
  const interviewer = createScriptedInterviewer(requests, {
    take: () => queue.shift(),
    queueName: () => "queued turn",
    delayMs: () => 0,
  });

  return {
    ...interviewer,
    requests,
    get remaining() {
      return queue.length;
    },
    push(...more: ScriptedTurn[]) {
      queue.push(...more);
    },
  };
}

/**
 * The fake with one queue per session, keyed by the session id every request
 * carries. A session's queue is built from the scenario chosen for it, or from
 * `defaultScenario` on its first request when none was. A fault in one
 * session's script fails only that session's request.
 */
export function createScenarioInterviewer(
  registry: Record<string, Scenario> = fakeScenarios,
  defaultScenario: string = DEFAULT_SCENARIO,
): ScenarioInterviewer {
  const sessions = new Map<string, { queue: ScriptedTurn[]; delayMs: number }>();
  const requests: InterviewerRequest[] = [];

  function scenarioNamed(name: string): Scenario {
    if (!Object.prototype.hasOwnProperty.call(registry, name)) {
      throw new Error(
        `Fake interviewer: no scenario named "${name}". Known: ${Object.keys(registry).join(", ")}.`,
      );
    }
    return registry[name]!;
  }

  function start(sessionId: string, name: string) {
    const scenario = scenarioNamed(name);
    const state = { queue: [...scenario.turns], delayMs: scenario.delayMs ?? 0 };
    sessions.set(sessionId, state);
    return state;
  }

  function sessionOf(request: InterviewerRequest) {
    const { sessionId } = request.context;
    return sessions.get(sessionId) ?? start(sessionId, defaultScenario);
  }

  const interviewer = createScriptedInterviewer(requests, {
    take: (request) => sessionOf(request).queue.shift(),
    queueName: (request) =>
      `scripted turn of session "${request.context.sessionId}"`,
    delayMs: (request) => sessionOf(request).delayMs,
  });

  return {
    ...interviewer,
    requests,
    useScenario(sessionId, name) {
      start(sessionId, name);
    },
    remainingFor(sessionId) {
      return sessions.get(sessionId)?.queue.length ?? null;
    },
  };
}

function createScriptedInterviewer(
  requests: InterviewerRequest[],
  source: TurnSource,
): Interviewer {
  // Like the real adapter, the payload is validated against
  // `resultSchemas[request.kind]`, which is what makes the cast at each method
  // below sound.
  async function serve(
    next: ScriptedTurn,
    request: InterviewerRequest,
    fellBack: boolean,
  ): Promise<CallResult<unknown>> {
    const delay = source.delayMs(request);
    if (delay > 0) await sleep(delay);

    if (isError(next)) throw next.error;

    const payload = "result" in next ? next.result : next.invalidResult;
    const rawOutput = JSON.stringify(payload ?? null);
    const parsed = resultSchemas[request.kind].safeParse(payload);
    if (!parsed.success) {
      throw new InterviewerError(
        "malformed-output",
        "The interviewer returned a result that does not match the expected shape.",
        JSON.stringify(parsed.error.issues).slice(0, 2000),
        { rawOutput, reason: schemaIssuesReason(parsed.error.issues) },
      );
    }

    return {
      turn: {
        result: parsed.data,
        // A fallback is a fresh conversation, so it never keeps the old id.
        conversationId:
          next.conversationId ??
          (fellBack ? null : conversationOf(request)) ??
          FAKE_CONVERSATION_ID,
      },
      rawOutput,
    };
  }

  async function turn(
    request: InterviewerRequest,
    observer: ModelCallObserver | undefined,
  ): Promise<InterviewerTurn<unknown>> {
    requests.push(request);

    const next = source.take(request);
    const queueName = source.queueName(request);
    if (!next) {
      throw new Error(
        `Fake interviewer: no ${queueName} for a "${request.kind}" request (${requests.length} requests so far). Script one.`,
      );
    }
    if (next.kind !== request.kind) {
      throw new Error(
        `Fake interviewer: next ${queueName} is "${next.kind}" but the request was "${request.kind}".`,
      );
    }

    const resumes = conversationOf(request) != null;
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
    scoutProject: (request: ScoutProjectRequest, observer?: ModelCallObserver) =>
      turn(request, observer) as Promise<
        InterviewerTurn<ResultFor<"scout-project">>
      >,
    scoutHandoff: (request: HandoffScoutRequest, observer?: ModelCallObserver) =>
      turn(request, observer) as Promise<
        InterviewerTurn<ResultFor<"handoff-scout">>
      >,
  };
}

/**
 * A judged idea, ready to be grilled: one idea-sourced evidence item, a
 * concrete objective that is not a process, and few enough unknowns. What
 * `readiness-ready` schedules for a session's one `assess-readiness`
 * request — the readiness scenarios run without a project, so nothing here
 * needs a citation.
 */
export function readinessReadyTurns(): ScriptedTurn[] {
  return [
    {
      kind: "assess-readiness",
      result: {
        evidence: [
          {
            text: "The idea names marathon runners preparing for a 16-week training block.",
            source: "idea",
            citation: null,
          },
        ],
        objective: "A tracker for a 16-week marathon training plan.",
        objectiveIsProcess: false,
        expectedOutcome: "A plan the runner can follow week by week.",
        unknowns: ["Whether it needs to sync across devices"],
        verdict: "ready",
        missing: [],
      },
    },
  ];
}

/**
 * A judged idea that is not ready: no evidence, no objective beyond a process
 * to run. What `readiness-not-ready` schedules for the same one
 * `assess-readiness` request.
 */
export function readinessNotReadyTurns(): ScriptedTurn[] {
  return [
    {
      kind: "assess-readiness",
      result: {
        evidence: [],
        objective: null,
        objectiveIsProcess: true,
        expectedOutcome: null,
        unknowns: [
          "What would actually get built",
          "Who the comparison is even for",
        ],
        verdict: "not-ready",
        missing: ["A single buildable thing, not a method for deciding one"],
      },
    },
  ];
}

/**
 * A round of one root decision, then a round of two more depending on it,
 * then nothing left to propose. Shared with {@link reopenStaleReviewTurns}:
 * this much of the tree has to exist and settle before reopening the root
 * means anything.
 */
function aSettledRootAndTwoDependents(): ScriptedTurn[] {
  return [
    {
      kind: "propose-round",
      result: aRound([
        aProposedDecision("shape", {
          title: "What shape should this take?",
          body: "The first thing to settle.",
        }),
      ]),
    },
    {
      kind: "propose-round",
      result: aRound([
        aProposedDecision("storage", {
          title: "Where does the data live?",
          body: "Storage follows from the shape.",
          dependsOn: ["shape"],
        }),
        aProposedDecision("sync", {
          title: "How does it sync?",
          body: "Sync follows from the shape too.",
          dependsOn: ["shape"],
        }),
      ]),
    },
    { kind: "propose-round", result: aRound([]) },
  ];
}

/**
 * A round, then a reopen of its root decision whose two dependents go stale:
 * one is reconfirmed, the other is re-asked with an updated question. What
 * `reopen-stale-review` schedules, in the order a session hits it: two rounds
 * to settle the tree, an empty proposal once nothing more is pending, the
 * reopened root answered again, the review itself, and one more empty
 * proposal once the re-asked decision has rejoined the tree on its own.
 */
export function reopenStaleReviewTurns(): ScriptedTurn[] {
  return [
    ...aSettledRootAndTwoDependents(),
    {
      kind: "review-stale",
      result: {
        reviews: [
          {
            decisionKey: "storage",
            verdict: "reconfirm",
            reason: "Storage still follows from the shape either way.",
            title: null,
            body: null,
            choices: [],
            recommendedChoice: null,
            recommendedAnswer: null,
          },
          {
            decisionKey: "sync",
            verdict: "re-ask",
            reason: "A single page syncs differently than a workspace.",
            title: "How does a single page stay current?",
            body: "The old answer assumed a workspace shape.",
            choices: [
              {
                label: "Poll",
                rationale: "Simple, costs a delay before the page catches up.",
              },
              {
                label: "Push",
                rationale: "Immediate, costs a channel to keep open.",
              },
            ],
            recommendedChoice: 1,
            recommendedAnswer: "Push, so the page never shows stale data.",
          },
        ],
      },
    },
    { kind: "propose-round", result: aRound([]) },
  ];
}

/**
 * A round of two independent decisions, a done proposal once one of them
 * settles and the other is left as a loose end, and the supersession check
 * that runs as the done proposal's second half. What `supersession`
 * schedules: the round, the empty done proposal, then `find-superseded`
 * naming the loose end and the decision that already answers it.
 */
export function supersessionTurns(): ScriptedTurn[] {
  return [
    {
      kind: "propose-round",
      result: aRound([
        aProposedDecision("shape", {
          title: "What shape should this take?",
          body: "The first thing to settle.",
        }),
        aProposedDecision("storage", {
          title: "Where does the data live?",
          body: "Storage is worth naming, even before it is settled.",
        }),
      ]),
    },
    {
      kind: "propose-round",
      result: aRound([], {
        done: {
          summary: "The shape is settled; nothing else is left to ask.",
        },
      }),
    },
    {
      kind: "find-superseded",
      result: {
        supersessions: [
          {
            looseEndKey: "storage",
            answeredByKey: "shape",
            answer: "On disk, inside the workspace shape.",
            reason:
              "The shape decision already commits to data living on disk.",
          },
        ],
      },
    },
  ];
}

/**
 * A round proposal refused once for a tree-rule violation (a dependency
 * cycle, which is invalid against any tree, empty or not), then accepted.
 * What `refusal-then-success` schedules: the retry is automatic, inside the
 * one turn `askUntilAccepted` runs, so the attempt log shows the refusal and
 * the success as two attempts of the same turn.
 */
export function refusalThenSuccessTurns(): ScriptedTurn[] {
  return [
    { kind: "propose-round", result: treeRuleViolation.cycle() },
    {
      kind: "propose-round",
      result: aRound([
        aProposedDecision("shape", {
          title: "What shape should this take?",
          body: "The first thing to settle.",
        }),
      ]),
    },
  ];
}

/**
 * A round proposal that is rate limited — which stops the turn outright,
 * unlike a tree-rule refusal — then accepted on a manual retry: a second,
 * separate call to the same action. What `rate-limit-then-retry` schedules;
 * the scenario's `delayMs`, set on its registry entry rather than here, is
 * what keeps each attempt's turn running long enough to see.
 */
export function rateLimitThenRetryTurns(): ScriptedTurn[] {
  return [
    rateLimitedTurn("propose-round"),
    {
      kind: "propose-round",
      result: aRound([
        aProposedDecision("shape", {
          title: "What shape should this take?",
          body: "The first thing to settle.",
        }),
      ]),
    },
  ];
}

/**
 * A first scout report: one current-state item and two proposed repo
 * decisions. Cites `src/ingest/metrics.ts` and `docs/adr/0003-queue.md` — the
 * same paths and line counts the shared `aScoutProjectResult` test fixture
 * cites — plus `CLAUDE.md`, which the same fixture repos carry (see
 * `scout-project.test.ts`'s `aFixtureRepo`). What `scout-project` schedules,
 * for a session's one `scout-project` request.
 */
export function scoutProjectTurns(): ScriptedTurn[] {
  return [
    {
      kind: "scout-project",
      result: {
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
            statement:
              "Ingest runs on a Postgres-backed queue, not a message broker.",
            source: "recorded",
            citation: "docs/adr/0003-queue.md:5-9",
            reason:
              "An alert on ingest lag reads the queue this decision chose.",
          },
          {
            key: "agent-instructions-exist",
            title: "The repo already documents agent conventions",
            statement:
              "CLAUDE.md exists at the repo root and is read by every agent that works here.",
            source: "inferred",
            citation: "CLAUDE.md:1",
            reason: "A scouted feature should follow the same conventions.",
          },
        ],
        previousDecisions: [],
      },
    },
  ];
}

/**
 * A grounding of a two-ticket handoff: ticket 1 adds an ingest-lag alert
 * beside the metrics it reads, and ticket 2, blocked by 1, wires that alert
 * into the queue. Ticket 2 depends on a file ticket 1 creates, so the result
 * exercises both halves of a dependency. Cites the same fixture paths as
 * {@link scoutProjectTurns}. What `handoff-scout` schedules, for a session's
 * one `handoff-scout` request.
 */
export function handoffScoutTurns(): ScriptedTurn[] {
  return [
    {
      kind: "handoff-scout",
      result: {
        tickets: [
          {
            number: 1,
            filesToChange: [
              { path: "src/ingest/lag-alert.ts", change: "create" },
              { path: "src/ingest/lag-alert.test.ts", change: "create" },
            ],
            buildsOnFiles: ["src/ingest/metrics.ts:12-30"],
            facts: [
              {
                statement: "Ingest lag is measured in src/ingest/metrics.ts.",
                citation: "src/ingest/metrics.ts:12-30",
              },
            ],
            buildsOn: [],
            provedBy: {
              testPath: "src/ingest/lag-alert.test.ts",
              command: "npm test -- lag-alert",
            },
          },
          {
            number: 2,
            filesToChange: [{ path: "src/ingest/metrics.ts", change: "edit" }],
            buildsOnFiles: ["docs/adr/0003-queue.md:5-9"],
            facts: [
              {
                statement: "Ingest runs on a Postgres-backed queue.",
                citation: "docs/adr/0003-queue.md:5-9",
              },
            ],
            buildsOn: [
              {
                blocker: 1,
                provides: "The lag alert module.",
                citation: null,
                createdPath: "src/ingest/lag-alert.ts",
                check: "test -f src/ingest/lag-alert.ts",
              },
            ],
            provedBy: {
              testPath: "src/ingest/lag-alert.test.ts",
              command: "npm test -- lag-alert",
            },
          },
        ],
      },
    },
  ];
}

/**
 * The scout-project flow through the UI, start to first round: the same
 * scout report {@link scoutProjectTurns} schedules, followed by the
 * readiness judge it grounds (evidence, an objective and a ready verdict
 * that pass `reasonsToRefuseReadiness`), then a first round that proposes a
 * decision unrelated to either repo proposal — so a test can keep one of the
 * scout's proposals and confirm the round never re-asks it.
 * `e2e/project-scout.spec.ts` is the one thing that schedules this; a
 * separate scenario from `scout-project` so `scenarios.test.ts`'s
 * `remainingFor(session.id)` assertion (exactly one `scout-project` request)
 * never has to change.
 */
export function scoutProjectReadinessTurns(): ScriptedTurn[] {
  return [
    ...scoutProjectTurns(),
    {
      kind: "assess-readiness",
      result: {
        evidence: [
          {
            text: "The idea names ingest lag as the alert target.",
            source: "idea",
            citation: null,
          },
        ],
        objective: "Alert when ingest lag crosses a threshold.",
        objectiveIsProcess: false,
        expectedOutcome: "An alert fires before ingest falls too far behind.",
        unknowns: [],
        verdict: "ready",
        missing: [],
      },
    },
    {
      kind: "propose-round",
      result: aRound([
        aProposedDecision("alert-trigger", {
          title: "What should trigger the alert?",
          body: "The threshold that fires a page.",
        }),
      ]),
    },
  ];
}

/**
 * A minimal complete interview: a first round proposal the app refuses for a
 * tree-rule violation, retried and accepted as one round of two questions,
 * then a proposal that we are done, the supersession check that follows it,
 * then a spec and its tickets. It is what the fake serves when it is selected
 * by environment variable rather than scripted by a test, so the browser
 * smoke test has an interview to walk through — including a turn with more
 * than one attempt, so the attempt log has something to show.
 */
export function cannedInterviewTurns(): ScriptedTurn[] {
  return [
    // Refused: depends on a decision that exists neither in the tree (empty,
    // this being the first round) nor in the proposal itself. Retried by the
    // same `askUntilAccepted` loop that serves the real interviewer, with the
    // next queued turn below the one it succeeds with.
    {
      kind: "propose-round",
      result: treeRuleViolation.unknownKey(),
    },
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
