import { afterEach, describe, expect, it } from "vitest";

import { InterviewerError } from "./errors.js";
import { cannedInterviewTurns, createFakeInterviewer } from "./fake.js";
import {
  getInterviewer,
  INTERVIEWER_ENV_VAR,
  resetInterviewer,
  scriptInterviewer,
} from "./index.js";
import {
  aFindSupersededRequest,
  aProposeRoundRequest,
  aProposeRoundResult,
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

  it("refuses a queued turn of the wrong kind", async () => {
    const interviewer = createFakeInterviewer([
      { kind: "propose-round", result: aProposeRoundResult() },
    ]);

    await expect(
      interviewer.synthesizeSpec(aSynthesizeSpecRequest()),
    ).rejects.toThrow(/"propose-round" but the request was "synthesize-spec"/);
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

    await interviewer.proposeRound(aProposeRoundRequest());
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

    const turn = await getInterviewer().proposeRound(aProposeRoundRequest());

    expect(turn.result.proposedDecisions).toHaveLength(2);
    // The same instance is reused, so the queue advances across calls.
    expect(getInterviewer()).toBe(getInterviewer());
  });
});
