import { afterEach, describe, expect, it } from "vitest";

import { validateProposal, type KeyedTreeDecision } from "../tree.js";
import { InterviewerError } from "./errors.js";
import {
  cannedInterviewTurns,
  createFakeInterviewer,
  createScenarioInterviewer,
  FAKE_CLI_METRICS,
  handoffScoutTurns,
  rateLimitedTurn,
  schemaInvalidTurn,
  treeRuleViolation,
  withResumeFallback,
} from "./fake.js";
import type { ProposeRoundResult } from "./schemas.js";
import type { ModelCallEnd, ModelCallObserver } from "./types.js";
import {
  getInterviewer,
  INTERVIEWER_ENV_VAR,
  resetInterviewer,
  scriptInterviewer,
} from "./index.js";
import {
  anAssessReadinessRequest,
  anAssessReadinessResult,
  aFindSupersededRequest,
  aFindSupersededResult,
  aHandoffScoutRequest,
  aHandoffScoutResult,
  aProposeRoundRequest,
  aProposeRoundResult,
  aScoutProjectRequest,
  aScoutProjectResult,
  aSynthesizeSpecRequest,
} from "./test-fixtures.js";

afterEach(() => {
  resetInterviewer();
  delete process.env[INTERVIEWER_ENV_VAR];
});

describe("the scripted fake interviewer", () => {
  it("returns queued results in the order they were scripted", async () => {
    const first = aProposeRoundResult();
    const second = aProposeRoundResult({
      proposedDecisions: [],
      done: { summary: "Everything is settled." },
    });
    const interviewer = createFakeInterviewer([
      { kind: "propose-round", result: first },
      { kind: "propose-round", result: second },
    ]);

    expect((await interviewer.proposeRound(aProposeRoundRequest())).result).toEqual(
      first,
    );
    expect((await interviewer.proposeRound(aProposeRoundRequest())).result).toEqual(
      second,
    );
    expect(interviewer.remaining).toBe(0);
  });

  it("records every request it was given, so tests can assert on them", async () => {
    const interviewer = createFakeInterviewer([
      { kind: "propose-round", result: aProposeRoundResult() },
    ]);
    const request = aProposeRoundRequest({
      latestAnswers: [
        { decisionKey: "shape", kind: "pushed-back", text: "Wrong level." },
      ],
    });

    await interviewer.proposeRound(request);

    expect(interviewer.requests).toEqual([request]);
    expect(interviewer.requests[0]).toMatchObject({
      kind: "propose-round",
      latestAnswers: [{ kind: "pushed-back", text: "Wrong level." }],
    });
  });

  it("hands back the conversation id the session already had", async () => {
    const interviewer = createFakeInterviewer([
      { kind: "propose-round", result: aProposeRoundResult() },
      { kind: "propose-round", result: aProposeRoundResult() },
    ]);

    expect(
      (await interviewer.proposeRound(aProposeRoundRequest())).conversationId,
    ).toBe("fake-conversation");
    expect(
      (
        await interviewer.proposeRound(
          aProposeRoundRequest({
            context: {
              ...aProposeRoundRequest().context,
              conversationId: "session-7",
            },
          }),
        )
      ).conversationId,
    ).toBe("session-7");
  });

  it("turns scripted schema-invalid output into a malformed-output error", async () => {
    const interviewer = createFakeInterviewer([
      {
        kind: "propose-round",
        invalidResult: { proposedDecisions: [{ key: "shape" }] },
      },
    ]);

    await expect(
      interviewer.proposeRound(aProposeRoundRequest()),
    ).rejects.toMatchObject({
      name: "InterviewerError",
      code: "malformed-output",
    });
  });

  it("throws each typed error it is scripted with", async () => {
    for (const code of [
      "cli-missing",
      "not-logged-in",
      "rate-limited",
      "failed",
    ] as const) {
      const interviewer = createFakeInterviewer([
        { kind: "propose-round", error: new InterviewerError(code, code) },
      ]);

      await expect(
        interviewer.proposeRound(aProposeRoundRequest()),
      ).rejects.toMatchObject({ code });
    }
  });

  it("reports an empty queue as a fault in the test, not an interviewer error", async () => {
    const interviewer = createFakeInterviewer();

    const error = await interviewer
      .proposeRound(aProposeRoundRequest())
      .catch((thrown: unknown) => thrown);

    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(InterviewerError);
    expect((error as Error).message).toContain("no queued turn");
  });

  it("answers a find-superseded request with no loose ends empty, without taking the next scripted turn", async () => {
    const round = aProposeRoundResult();
    const interviewer = createFakeInterviewer([
      { kind: "propose-round", result: round },
    ]);

    const checked = await interviewer.findSuperseded(
      aFindSupersededRequest({ looseEndKeys: [], replaceableKeys: ["shape"] }),
    );

    expect(checked.result).toEqual({
      supersessions: [],
      replacements: [],
      restatements: [],
      deferrals: [],
    });
    expect(interviewer.remaining).toBe(1);
    expect((await interviewer.proposeRound(aProposeRoundRequest())).result).toEqual(
      round,
    );
  });

  it("reports its canned usage for an unscripted find-superseded answer", async () => {
    const interviewer = createFakeInterviewer([]);
    const { observer, ended } = recordingObserver();

    await interviewer.findSuperseded(
      aFindSupersededRequest({ looseEndKeys: [], replaceableKeys: ["shape"] }),
      observer,
    );

    expect(ended).toHaveLength(1);
    expect(ended[0].metrics).toEqual(FAKE_CLI_METRICS);
  });

  it("answers a find-superseded request with no loose ends empty when nothing is left to take", async () => {
    const interviewer = createFakeInterviewer();

    const checked = await interviewer.findSuperseded(
      aFindSupersededRequest({ looseEndKeys: [], replaceableKeys: ["shape"] }),
    );

    expect(checked.result).toEqual({
      supersessions: [],
      replacements: [],
      restatements: [],
      deferrals: [],
    });
    expect(interviewer.requests).toHaveLength(1);
  });

  it("serves a scripted find-superseded turn to a request with no loose ends when it is next", async () => {
    const scripted = aFindSupersededResult({
      supersessions: [],
      replacements: [{ replacedKey: "shape", byKey: "storage", reason: "Moved." }],
    });
    const interviewer = createFakeInterviewer([
      { kind: "find-superseded", result: scripted },
    ]);

    const checked = await interviewer.findSuperseded(
      aFindSupersededRequest({ looseEndKeys: [], replaceableKeys: ["shape"] }),
    );

    expect(checked.result).toEqual(scripted);
    expect(interviewer.remaining).toBe(0);
  });

  it("still takes the next scripted turn for a find-superseded request with loose ends", async () => {
    const interviewer = createFakeInterviewer([
      { kind: "propose-round", result: aProposeRoundResult() },
    ]);

    await expect(
      interviewer.findSuperseded(aFindSupersededRequest()),
    ).rejects.toThrow(/"propose-round" but the request was "find-superseded"/);
  });

  it("refuses a queued turn of the wrong kind", async () => {
    const interviewer = createFakeInterviewer([
      { kind: "propose-round", result: aProposeRoundResult() },
    ]);

    await expect(
      interviewer.synthesizeSpec(aSynthesizeSpecRequest()),
    ).rejects.toThrow(/"propose-round" but the request was "synthesize-spec"/);
  });

  it("serves a scripted readiness judgment", async () => {
    const interviewer = createFakeInterviewer([
      { kind: "assess-readiness", result: anAssessReadinessResult() },
    ]);

    const turn = await interviewer.assessReadiness(anAssessReadinessRequest());

    expect(turn.result).toEqual(anAssessReadinessResult());
    expect(interviewer.requests[0]?.kind).toBe("assess-readiness");
  });

  it("serves a scripted scout report, in a conversation of its own", async () => {
    const interviewer = createFakeInterviewer([
      { kind: "scout-project", result: aScoutProjectResult() },
    ]);
    const request = aScoutProjectRequest({
      context: { ...aScoutProjectRequest().context, conversationId: "session-7" },
    });
    const calls: ModelCallEnd[] = [];

    const turn = await interviewer.scoutProject(request, {
      callEnded: (call) => void calls.push(call),
    });

    expect(turn.result).toEqual(aScoutProjectResult());
    expect(turn.conversationId).not.toBe("session-7");
    expect(calls.map((call) => call.conversation)).toEqual(["new"]);
    expect(interviewer.requests[0]).toMatchObject({
      kind: "scout-project",
      facts: request.facts,
    });
  });

  it("refuses a scripted scout report the schema rejects", async () => {
    const interviewer = createFakeInterviewer([
      schemaInvalidTurn("scout-project", {
        ...aScoutProjectResult(),
        proposedDecisions: [
          { ...aScoutProjectResult().proposedDecisions[0], citation: "/etc/passwd:1" },
        ],
      }),
    ]);

    await expect(
      interviewer.scoutProject(aScoutProjectRequest()),
    ).rejects.toMatchObject({ code: "malformed-output" });
  });

  it("serves a scripted handoff grounding, in a conversation of its own", async () => {
    const interviewer = createFakeInterviewer([
      { kind: "handoff-scout", result: aHandoffScoutResult() },
    ]);
    const request = aHandoffScoutRequest({
      context: { ...aHandoffScoutRequest().context, conversationId: "session-7" },
    });
    const calls: ModelCallEnd[] = [];

    const turn = await interviewer.scoutHandoff(request, {
      callEnded: (call) => void calls.push(call),
    });

    expect(turn.result).toEqual(aHandoffScoutResult());
    expect(turn.conversationId).not.toBe("session-7");
    expect(calls.map((call) => call.conversation)).toEqual(["new"]);
    expect(interviewer.requests[0]).toMatchObject({
      kind: "handoff-scout",
      tickets: request.tickets,
    });
  });

  it("serves the handoff-scout scenario's grounding for a session", async () => {
    const interviewer = createScenarioInterviewer();
    const request = aHandoffScoutRequest();
    interviewer.useScenario(request.context.sessionId, "handoff-scout");

    const turn = await interviewer.scoutHandoff(request);

    const scripted = handoffScoutTurns();
    expect(scripted).toHaveLength(1);
    expect(scripted[0]).toMatchObject({ kind: "handoff-scout", result: turn.result });
    expect(turn.result.tickets.map((ticket) => ticket.number)).toEqual([1, 2]);
    expect(interviewer.remainingFor(request.context.sessionId)).toBe(0);
  });

  it("refuses a scripted handoff grounding the schema rejects", async () => {
    const [first, second] = aHandoffScoutResult().tickets;
    const interviewer = createFakeInterviewer([
      schemaInvalidTurn("handoff-scout", {
        tickets: [first, { ...second, filesToChange: [{ path: "src/a.ts", change: "delete" }] }],
      }),
    ]);

    await expect(
      interviewer.scoutHandoff(aHandoffScoutRequest()),
    ).rejects.toMatchObject({ code: "malformed-output" });
  });

  it("accepts turns appended after it was created", async () => {
    const interviewer = createFakeInterviewer();
    interviewer.push({ kind: "propose-round", result: aProposeRoundResult() });

    await expect(
      interviewer.proposeRound(aProposeRoundRequest()),
    ).resolves.toMatchObject({ result: aProposeRoundResult() });
  });

  it("serves a complete canned interview that passes validation", async () => {
    const interviewer = createFakeInterviewer(cannedInterviewTurns());

    // Round 1's turn is refused once, for a tree-rule violation, before the
    // retry that succeeds — see `cannedInterviewTurns()`.
    const refused = await interviewer.proposeRound(aProposeRoundRequest());
    expect(refused.result.proposedDecisions[0]?.dependsOn).toContain(
      "fake-no-such-decision",
    );

    const round = await interviewer.proposeRound(aProposeRoundRequest());
    expect(round.result.proposedDecisions).toHaveLength(2);

    const done = await interviewer.proposeRound(aProposeRoundRequest());
    const superseded = await interviewer.findSuperseded(
      aFindSupersededRequest(),
    );
    const spec = await interviewer.synthesizeSpec(aSynthesizeSpecRequest());

    expect(done.result.done?.summary).toContain("Settled");
    expect(superseded.result.supersessions).toEqual([]);
    expect(spec.result.markdown).toContain("## Problem Statement");
  });
});

describe("choosing the interviewer", () => {
  it("returns the fake the test scripted", () => {
    const interviewer = scriptInterviewer([
      { kind: "propose-round", result: aProposeRoundResult() },
    ]);

    expect(getInterviewer()).toBe(interviewer);
  });

  it("serves the canned interview when configuration selects the fake", async () => {
    process.env[INTERVIEWER_ENV_VAR] = "fake";
    resetInterviewer();

    // Round 1's turn is refused once before the retry that succeeds — see
    // `cannedInterviewTurns()`.
    await getInterviewer().proposeRound(aProposeRoundRequest());
    const turn = await getInterviewer().proposeRound(aProposeRoundRequest());

    expect(turn.result.proposedDecisions).toHaveLength(2);
    // The same instance is reused, so the queue advances across calls.
    expect(getInterviewer()).toBe(getInterviewer());
  });
});

function recordingObserver() {
  const ended: ModelCallEnd[] = [];
  const events: string[] = [];
  const observer: ModelCallObserver = {
    callStarted: (call) => {
      events.push(`start ${call.call} ${call.conversation}`);
    },
    callEnded: (call) => {
      events.push(`end ${call.call} ${call.outcome.kind}`);
      ended.push(call);
    },
  };
  return { observer, ended, events };
}

const resumingRequest = aProposeRoundRequest({
  context: { ...aProposeRoundRequest().context, conversationId: "session-7" },
});

describe("scripting every outcome of a model call", () => {
  it("reports a clean success as one call with the raw output", async () => {
    const interviewer = createFakeInterviewer([
      { kind: "propose-round", result: aProposeRoundResult() },
    ]);
    const { observer, ended, events } = recordingObserver();

    await interviewer.proposeRound(aProposeRoundRequest(), observer);

    expect(events).toEqual(["start 1 new", "end 1 success"]);
    expect(ended[0].outcome).toEqual({
      kind: "success",
      rawOutput: JSON.stringify(aProposeRoundResult()),
    });
  });

  it("reports a resumed conversation as resumed", async () => {
    const interviewer = createFakeInterviewer([
      { kind: "propose-round", result: aProposeRoundResult() },
    ]);
    const { observer, events } = recordingObserver();

    await interviewer.proposeRound(resumingRequest, observer);

    expect(events).toEqual(["start 1 resumed", "end 1 success"]);
  });

  it("scripts schema-invalid output, with its raw output and a one-line reason", async () => {
    const interviewer = createFakeInterviewer([
      schemaInvalidTurn("propose-round", { proposedDecisions: "nope" }),
    ]);
    const { observer, ended } = recordingObserver();

    await expect(
      interviewer.proposeRound(aProposeRoundRequest(), observer),
    ).rejects.toMatchObject({ code: "malformed-output" });
    expect(ended[0].outcome).toMatchObject({
      kind: "schema-invalid",
      rawOutput: JSON.stringify({ proposedDecisions: "nope" }),
      reason: expect.stringContaining("Schema mismatch"),
    });
  });

  it("scripts a rate limit, distinct from an interviewer error", async () => {
    const interviewer = createFakeInterviewer([rateLimitedTurn("propose-round")]);
    const { observer, ended } = recordingObserver();

    await expect(
      interviewer.proposeRound(aProposeRoundRequest(), observer),
    ).rejects.toMatchObject({ code: "rate-limited" });
    expect(ended.map((call) => call.outcome.kind)).toEqual(["rate-limited"]);
  });

  it("reports any other scripted error as an error, carrying its code", async () => {
    const interviewer = createFakeInterviewer([
      { kind: "propose-round", error: new InterviewerError("not-logged-in", "Log in.") },
    ]);
    const { observer, ended } = recordingObserver();

    await interviewer
      .proposeRound(aProposeRoundRequest(), observer)
      .catch(() => undefined);

    expect(ended[0].outcome).toEqual({
      kind: "error",
      code: "not-logged-in",
      reason: "Log in.",
    });
  });

  it("scripts a resume fallback as a call of its own, before the turn it serves", async () => {
    const interviewer = createFakeInterviewer([
      withResumeFallback({ kind: "propose-round", result: aProposeRoundResult() }),
    ]);
    const { observer, ended, events } = recordingObserver();

    const turn = await interviewer.proposeRound(resumingRequest, observer);

    expect(events).toEqual([
      "start 1 resumed",
      "end 1 resume-fallback",
      "start 2 primed-after-resume",
      "end 2 success",
    ]);
    expect(ended[0].outcome.kind).toBe("resume-fallback");
    // The fallback is a fresh conversation, not the one that could not resume.
    expect(turn.conversationId).toBe("fake-conversation");
  });

  it("scripts a resume fallback followed by any other outcome", async () => {
    const interviewer = createFakeInterviewer([
      withResumeFallback(rateLimitedTurn("propose-round"), "Session is gone."),
    ]);
    const { observer, ended } = recordingObserver();

    await expect(
      interviewer.proposeRound(resumingRequest, observer),
    ).rejects.toMatchObject({ code: "rate-limited" });
    expect(ended.map((call) => call.outcome)).toEqual([
      { kind: "resume-fallback", reason: "Session is gone." },
      expect.objectContaining({ kind: "rate-limited" }),
    ]);
  });

  it("serves a resume fallback without an observer exactly like the turn itself", async () => {
    const interviewer = createFakeInterviewer([
      withResumeFallback({ kind: "propose-round", result: aProposeRoundResult() }),
    ]);

    await expect(
      interviewer.proposeRound(resumingRequest),
    ).resolves.toMatchObject({ result: aProposeRoundResult() });
  });

  it("refuses a resume fallback for a request that resumes nothing, as a fault in the test", async () => {
    const interviewer = createFakeInterviewer([
      withResumeFallback({ kind: "propose-round", result: aProposeRoundResult() }),
    ]);

    const error = await interviewer
      .proposeRound(aProposeRoundRequest())
      .catch((thrown: unknown) => thrown);

    expect(error).not.toBeInstanceOf(InterviewerError);
    expect((error as Error).message).toContain("no conversation to resume");
  });
});

describe("scripting proposals that break a tree rule", () => {
  /** A tree of one settled decision and one the user pushed back on. */
  const existing: KeyedTreeDecision[] = [
    {
      id: "id-shape",
      key: "shape",
      title: "What shape should this take?",
      body: "The first thing to settle.",
      dependsOn: [],
      answerKind: "own-answer",
      settledAt: "2026-01-01T00:00:00.000Z",
      reopenedAt: null,
    },
    {
      id: "id-storage",
      key: "storage",
      title: "Where does the data live?",
      body: "Storage follows from the shape.",
      dependsOn: ["id-shape"],
      answerKind: "pushed-back",
      settledAt: null,
      reopenedAt: null,
    },
  ];

  /** The reasons the app gives for refusing a proposal against that tree. */
  function refusals(result: ProposeRoundResult): string[] {
    const withPushBackAnswered =
      result.pushBackResponses.length > 0
        ? result
        : {
            ...result,
            pushBackResponses: [
              {
                decisionKey: "storage",
                response: "withdraw" as const,
                explanation: "Not needed.",
                replacementKey: null,
              },
            ],
          };
    return validateProposal(existing, withPushBackAnswered.proposedDecisions, {
      pushBackResponses: withPushBackAnswered.pushBackResponses,
      userDecisionPlacements: withPushBackAnswered.userDecisionPlacements,
      done: withPushBackAnswered.done != null,
    }).reasons;
  }

  it.each([
    ["off-frontier question", treeRuleViolation.offFrontier(), /not on the frontier/],
    ["unknown key", treeRuleViolation.unknownKey(), /neither an existing decision/],
    ["cycle", treeRuleViolation.cycle(), /dependency cycle/],
    [
      "unchanged re-ask",
      treeRuleViolation.unchangedReAsk({
        key: "storage",
        title: "Where does the data live?",
        body: "Storage follows from the shape.",
      }),
      /re-asks it unchanged/,
    ],
    [
      "duplicate title",
      treeRuleViolation.duplicateTitle("What shape should this take?"),
      /asks the same question/,
    ],
  ])("scripts an %s the app refuses", async (_rule, result, reason) => {
    const interviewer = createFakeInterviewer([
      { kind: "propose-round", result },
    ]);

    const turn = await interviewer.proposeRound(aProposeRoundRequest());

    expect(refusals(turn.result).join(" ")).toMatch(reason);
  });

  it("scripts refusals followed by a success, in sequence", async () => {
    const interviewer = createFakeInterviewer([
      { kind: "propose-round", result: treeRuleViolation.cycle() },
      { kind: "propose-round", result: treeRuleViolation.unknownKey() },
      { kind: "propose-round", result: aProposeRoundResult() },
    ]);
    const { observer, ended } = recordingObserver();

    for (let attempt = 0; attempt < 3; attempt += 1) {
      await interviewer.proposeRound(aProposeRoundRequest(), observer);
    }

    // Every one is a successful model call: refusing it is the app's call.
    expect(ended.map((call) => call.outcome.kind)).toEqual([
      "success",
      "success",
      "success",
    ]);
    expect(interviewer.remaining).toBe(0);
  });
});
