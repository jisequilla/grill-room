import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createScenarioInterviewer,
  DEFAULT_SCENARIO,
  fakeScenarios,
  rateLimitedTurn,
  type Scenario,
} from "./fake.js";
import {
  getInterviewer,
  INTERVIEWER_ENV_VAR,
  resetInterviewer,
  selectedFakeInterviewer,
} from "./index.js";
import type { ModelCallObserver } from "./types.js";
import {
  aContext,
  anAssessReadinessRequest,
  anAssessReadinessResult,
  aProposeRoundRequest,
  aProposeRoundResult,
} from "./test-fixtures.js";

afterEach(() => {
  vi.useRealTimers();
  resetInterviewer();
  delete process.env[INTERVIEWER_ENV_VAR];
});

function proposeFor(sessionId: string) {
  return aProposeRoundRequest({ context: aContext({ sessionId }) });
}

function readinessFor(sessionId: string) {
  return anAssessReadinessRequest({ context: aContext({ sessionId }) });
}

const notReady = anAssessReadinessResult({ verdict: "not-ready" });

const registry: Record<string, Scenario> = {
  rounds: {
    turns: [
      { kind: "propose-round", result: aProposeRoundResult() },
      {
        kind: "propose-round",
        result: aProposeRoundResult({
          proposedDecisions: [],
          done: { summary: "Settled." },
        }),
      },
    ],
  },
  readiness: {
    turns: [{ kind: "assess-readiness", result: notReady }],
  },
  slow: {
    turns: [{ kind: "assess-readiness", result: notReady }],
    delayMs: 5_000,
  },
};

describe("the per-session scenario fake", () => {
  it("serves each session from its own scenario", async () => {
    const interviewer = createScenarioInterviewer(registry, "rounds");
    interviewer.useScenario("a", "rounds");
    interviewer.useScenario("b", "readiness");

    const first = await interviewer.proposeRound(proposeFor("a"));
    const judged = await interviewer.assessReadiness(readinessFor("b"));
    const second = await interviewer.proposeRound(proposeFor("a"));

    expect(first.result.proposedDecisions).toHaveLength(1);
    expect(judged.result.verdict).toBe("not-ready");
    expect(second.result.done).toEqual({ summary: "Settled." });
    expect(interviewer.remainingFor("a")).toBe(0);
    expect(interviewer.remainingFor("b")).toBe(0);
  });

  it("fails a request its session's script did not expect, naming both kinds, and leaves other sessions alone", async () => {
    const interviewer = createScenarioInterviewer(registry, "rounds");
    interviewer.useScenario("a", "readiness");
    interviewer.useScenario("b", "readiness");

    await expect(interviewer.proposeRound(proposeFor("a"))).rejects.toThrow(
      'next scripted turn of session "a" is "assess-readiness" but the request was "propose-round"',
    );

    const judged = await interviewer.assessReadiness(readinessFor("b"));
    expect(judged.result.verdict).toBe("not-ready");
  });

  it("reports a session that ran out of turns by name", async () => {
    const interviewer = createScenarioInterviewer(registry, "rounds");
    interviewer.useScenario("a", "readiness");
    await interviewer.assessReadiness(readinessFor("a"));

    await expect(interviewer.assessReadiness(readinessFor("a"))).rejects.toThrow(
      'no scripted turn of session "a" for a "assess-readiness" request',
    );
  });

  it("serves the default scenario to a session that chose none", async () => {
    const interviewer = createScenarioInterviewer(registry, "rounds");

    const turn = await interviewer.proposeRound(proposeFor("unchosen"));

    expect(turn.result.proposedDecisions).toHaveLength(1);
    expect(interviewer.remainingFor("unchosen")).toBe(1);
  });

  it("defaults to the canned interview, one copy per session", async () => {
    const interviewer = createScenarioInterviewer();
    const canned = fakeScenarios[DEFAULT_SCENARIO]!.turns;

    // Each session's first turn is the canned refusal, then the real round.
    for (const sessionId of ["a", "b"]) {
      await interviewer.proposeRound(proposeFor(sessionId));
      const round = await interviewer.proposeRound(proposeFor(sessionId));
      expect(round.result.proposedDecisions.map((d) => d.key)).toEqual([
        "shape",
        "storage",
      ]);
      expect(interviewer.remainingFor(sessionId)).toBe(canned.length - 2);
    }
  });

  it("replaces a session's queue when a scenario is chosen again", async () => {
    const interviewer = createScenarioInterviewer(registry, "rounds");
    await interviewer.proposeRound(proposeFor("a"));
    expect(interviewer.remainingFor("a")).toBe(1);

    interviewer.useScenario("a", "readiness");

    expect(interviewer.remainingFor("a")).toBe(1);
    const judged = await interviewer.assessReadiness(readinessFor("a"));
    expect(judged.result.verdict).toBe("not-ready");
  });

  it("refuses a scenario the registry does not have", () => {
    const interviewer = createScenarioInterviewer(registry, "rounds");

    expect(() => interviewer.useScenario("a", "no-such")).toThrow(
      'no scenario named "no-such"',
    );
  });

  it("waits the scenario's delay inside the model call before answering", async () => {
    vi.useFakeTimers();
    const interviewer = createScenarioInterviewer(registry, "rounds");
    interviewer.useScenario("a", "slow");
    const events: string[] = [];
    const observer: ModelCallObserver = {
      callStarted: () => {
        events.push("start");
      },
      callEnded: (call) => {
        events.push(`end ${call.outcome.kind} ${call.durationMs}`);
      },
    };

    let settled = false;
    const answer = interviewer
      .assessReadiness(readinessFor("a"), observer)
      .then((turn) => {
        settled = true;
        return turn;
      });

    await vi.advanceTimersByTimeAsync(4_999);
    expect(settled).toBe(false);
    expect(events).toEqual(["start"]);

    await vi.advanceTimersByTimeAsync(1);
    expect((await answer).result.verdict).toBe("not-ready");
    expect(events).toEqual(["start", "end success 5000"]);
  });

  it("delays a scripted failure too", async () => {
    vi.useFakeTimers();
    const interviewer = createScenarioInterviewer(
      { limited: { turns: [rateLimitedTurn("propose-round")], delayMs: 100 } },
      "limited",
    );

    let rejected = false;
    const answer = interviewer.proposeRound(proposeFor("a")).catch((error) => {
      rejected = true;
      return error;
    });

    await vi.advanceTimersByTimeAsync(99);
    expect(rejected).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(await answer).toMatchObject({ code: "rate-limited" });
  });
});

describe("selecting the fake by configuration", () => {
  it("serves the per-session fake, the same instance scenarios are chosen on", async () => {
    process.env[INTERVIEWER_ENV_VAR] = "fake";

    const fake = selectedFakeInterviewer();

    expect(fake).not.toBeNull();
    expect(getInterviewer()).toBe(fake);
  });

  it("has no scenario fake when the real interviewer is selected", () => {
    expect(selectedFakeInterviewer()).toBeNull();
  });
});
