import { afterEach, describe, expect, it, vi } from "vitest";

import acceptDeferral from "../../actions/accept-deferral.js";
import assessReadiness from "../../actions/assess-readiness.js";
import createSession from "../../actions/create-session.js";
import getTree from "../../actions/get-tree.js";
import registerProject from "../../actions/register-project.js";
import reopenDecision from "../../actions/reopen-decision.js";
import requestNextRound from "../../actions/request-next-round.js";
import saveDraftAnswer from "../../actions/save-draft-answer.js";
import scoutProject from "../../actions/scout-project.js";
import submitRound from "../../actions/submit-round.js";
import { useTestDatabase } from "../../test/db.js";
import { useTempGitRepos } from "../../test/git-repos.js";
import {
  createScenarioInterviewer,
  DEFAULT_SCENARIO,
  fakeScenarios,
  rateLimitedTurn,
  type Scenario,
  type ScenarioInterviewer,
} from "./fake.js";
import {
  getInterviewer,
  INTERVIEWER_ENV_VAR,
  resetInterviewer,
  selectedFakeInterviewer,
  setInterviewer,
} from "./index.js";
import type { FindSupersededRequest, ModelCallObserver } from "./types.js";
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

/*
 * The named scenarios the registry serves for every request kind (ticket
 * gr-3uc.2). Each test drives the scenario through the actions its browser
 * test (ticket 03) will call, from a fresh session's first request, and
 * checks every scripted turn was consumed in order and the queue ends empty.
 */
describe("named scenarios for every request kind", () => {
  useTestDatabase();
  afterEach(resetInterviewer);

  const repos = useTempGitRepos();

  /** Installs a fresh per-session fake and puts `sessionId` on `name`. */
  function useScenario(sessionId: string, name: string): ScenarioInterviewer {
    const interviewer = createScenarioInterviewer(fakeScenarios);
    interviewer.useScenario(sessionId, name);
    setInterviewer(interviewer);
    return interviewer;
  }

  function aSession(overrides: { projectId?: string } = {}) {
    return createSession.run({
      title: "Marathon Tracker",
      idea: "A 16-week marathon training tracker for one runner.",
      ...overrides,
    });
  }

  /** Answers every card of the session's open round the same way. */
  async function answerOpenRound(
    sessionId: string,
    answerKind: "own-answer" | "unknown" = "own-answer",
    answer = "An answer.",
  ) {
    const { round } = await requestNextRound.run({ sessionId });
    for (const card of round?.decisions ?? []) {
      await saveDraftAnswer.run({ decisionId: card.id, answerKind, answer });
    }
    return submitRound.run({ id: round!.id });
  }

  /** Answers each named card of the session's open round differently. */
  async function answerOpenRoundByKey(
    sessionId: string,
    answers: Record<string, { answerKind: "own-answer" | "unknown"; answer?: string }>,
  ) {
    const { round } = await requestNextRound.run({ sessionId });
    for (const card of round?.decisions ?? []) {
      const given = card.key ? answers[card.key] : undefined;
      if (!given) throw new Error(`No scripted answer for card "${card.key}"`);
      await saveDraftAnswer.run({
        decisionId: card.id,
        answerKind: given.answerKind,
        answer: given.answer ?? "An answer.",
      });
    }
    return submitRound.run({ id: round!.id });
  }

  it.each(["readiness-ready", "readiness-not-ready"] as const)(
    "%s scripts one assess-readiness request",
    async (name) => {
      const session = await aSession();
      const interviewer = useScenario(session.id, name);

      const judged = await assessReadiness.run({ sessionId: session.id });

      expect(interviewer.requests.map((request) => request.kind)).toEqual([
        "assess-readiness",
      ]);
      expect(judged.readiness?.result.verdict).toBe(
        name === "readiness-ready" ? "ready" : "not-ready",
      );
      expect(interviewer.remainingFor(session.id)).toBe(0);
    },
  );

  it("reopen-stale-review scripts a round, a reopen, its review, and the round the re-ask reopens", async () => {
    const session = await aSession();
    const interviewer = useScenario(session.id, "reopen-stale-review");

    // Round 1: the root. Round 2: two dependents. Round 3: nothing more.
    await answerOpenRound(session.id);
    await answerOpenRound(session.id);

    const shape = (await getTree.run({ sessionId: session.id })).decisions.find(
      (decision) => decision.key === "shape",
    )!;
    await reopenDecision.run({ decisionId: shape.id });
    const afterReview = await answerOpenRound(session.id, "own-answer", "A page, after all.");

    expect(interviewer.requests.map((request) => request.kind)).toEqual([
      "propose-round",
      "propose-round",
      "propose-round",
      "review-stale",
      "propose-round",
    ]);
    expect(interviewer.requests[3]).toMatchObject({
      kind: "review-stale",
      reopenedDecisionKey: "shape",
      staleDecisionKeys: ["storage", "sync"],
    });
    // Storage was reconfirmed; sync was re-asked and rejoined the tree as the
    // round this reopen ends on.
    expect(afterReview.round?.decisions.map((card) => card.key)).toEqual([
      "sync",
    ]);
    expect(interviewer.remainingFor(session.id)).toBe(0);
  });

  it("supersession scripts a round, its done proposal, and the check that follows it", async () => {
    const session = await aSession();
    const interviewer = useScenario(session.id, "supersession");

    const done = await answerOpenRoundByKey(session.id, {
      shape: { answerKind: "own-answer", answer: "A workspace, on disk." },
      storage: { answerKind: "unknown" },
    });

    expect(interviewer.requests.map((request) => request.kind)).toEqual([
      "propose-round",
      "propose-round",
      "find-superseded",
    ]);
    expect(interviewer.requests[2]).toMatchObject({
      kind: "find-superseded",
      looseEndKeys: ["storage"],
    });
    expect(done.state).toBe("done-proposed");
    expect(interviewer.remainingFor(session.id)).toBe(0);
  });

  it("replacement scripts two rounds, the done proposal, and a check that proposes the later decision as replacing the earlier", async () => {
    const session = await aSession();
    const interviewer = useScenario(session.id, "replacement");

    const { round } = await requestNextRound.run({ sessionId: session.id });
    expect(round?.decisions.map((card) => card.key)).toEqual(["storage"]);
    await saveDraftAnswer.run({
      decisionId: round!.decisions[0]!.id,
      answerKind: "accepted-recommendation",
    });
    const second = await submitRound.run({ id: round!.id });
    expect(second.round?.decisions.map((card) => card.key)).toEqual([
      "storage-location",
    ]);
    await saveDraftAnswer.run({
      decisionId: second.round!.decisions[0]!.id,
      answerKind: "own-answer",
      answer: "A synced cloud folder.",
    });
    const done = await submitRound.run({ id: second.round!.id });

    expect(interviewer.requests.map((request) => request.kind)).toEqual([
      "propose-round",
      "propose-round",
      "propose-round",
      "find-superseded",
    ]);
    expect(interviewer.requests[3]).toMatchObject({
      kind: "find-superseded",
      looseEndKeys: [],
      replaceableKeys: ["storage"],
    });
    expect((interviewer.requests[3] as FindSupersededRequest).laterKeys).toEqual({
      storage: ["storage-location"],
    });
    expect(done.state).toBe("done-proposed");
    expect(interviewer.remainingFor(session.id)).toBe(0);

    const tree = await getTree.run({ sessionId: session.id });
    const storage = tree.decisions.find((decision) => decision.key === "storage");
    expect(storage).toMatchObject({
      answer: { kind: "accepted-recommendation" },
      supersession: { kind: "replaces-settled", byKey: "storage-location" },
      replacedBy: null,
    });
  });

  it("deferral scripts a round, its done proposal, a check that flags one own answer, and the round that asks it again once accepted", async () => {
    const session = await aSession();
    const interviewer = useScenario(session.id, "deferral");

    const done = await answerOpenRoundByKey(session.id, {
      "hold-period": {
        answerKind: "own-answer",
        answer: "Wait until dispute handling is settled",
      },
      "first-service": { answerKind: "own-answer", answer: "Dog walking." },
    });

    expect(interviewer.requests.map((request) => request.kind)).toEqual([
      "propose-round",
      "propose-round",
      "find-superseded",
    ]);
    expect(interviewer.requests[2]).toMatchObject({
      kind: "find-superseded",
      looseEndKeys: [],
      replaceableKeys: [],
      deferrableKeys: ["hold-period", "first-service"],
    });
    expect(done.state).toBe("done-proposed");

    const tree = await getTree.run({ sessionId: session.id });
    const hold = tree.decisions.find((decision) => decision.key === "hold-period")!;
    expect(hold).toMatchObject({
      state: "settled",
      answer: { kind: "own-answer" },
      deferralReason: expect.stringContaining("dispute handling"),
    });
    expect(
      tree.decisions.find((decision) => decision.key === "first-service"),
    ).toMatchObject({ deferralReason: null });

    await acceptDeferral.run({ decisionId: hold.id });
    const again = await requestNextRound.run({ sessionId: session.id });

    expect(again.round?.decisions.map((card) => card.key)).toEqual([
      "hold-period",
    ]);
    expect(interviewer.remainingFor(session.id)).toBe(0);
  });

  it("refusal-then-success scripts one refused attempt and the accepted retry, in the same turn", async () => {
    const session = await aSession();
    const interviewer = useScenario(session.id, "refusal-then-success");

    const opened = await requestNextRound.run({ sessionId: session.id });

    expect(interviewer.requests.map((request) => request.kind)).toEqual([
      "propose-round",
      "propose-round",
    ]);
    expect(opened.round?.decisions.map((card) => card.key)).toEqual(["shape"]);
    expect(interviewer.remainingFor(session.id)).toBe(0);
  });

  it(
    "rate-limit-then-retry scripts a rate limit that stops the turn, then a manual retry that succeeds",
    // This test runs the scenario's real, un-mocked `delayMs` twice in
    // sequence (the rate-limited attempt, then the manual retry), so it
    // needs more than vitest's default 5 s test timeout.
    async () => {
      const session = await aSession();
      const interviewer = useScenario(session.id, "rate-limit-then-retry");
      expect(fakeScenarios["rate-limit-then-retry"]?.delayMs).toBeGreaterThan(0);

      await expect(
        requestNextRound.run({ sessionId: session.id }),
      ).rejects.toThrow(/rate limited/);

      // The manual retry: a second, separate call to the same action.
      const opened = await requestNextRound.run({ sessionId: session.id });

      expect(interviewer.requests.map((request) => request.kind)).toEqual([
        "propose-round",
        "propose-round",
      ]);
      expect(opened.round?.decisions.map((card) => card.key)).toEqual(["shape"]);
      expect(interviewer.remainingFor(session.id)).toBe(0);
    },
    15_000,
  );

  it("scout-project scripts one scout-project request, citing files the fixture project holds", async () => {
    const root = repos.create({
      files: {
        "src/ingest/metrics.ts":
          Array.from({ length: 30 }, (_, i) => `line ${i + 1}`).join("\n") + "\n",
        "docs/adr/0003-queue.md":
          Array.from({ length: 9 }, (_, i) => `line ${i + 1}`).join("\n") + "\n",
        "CLAUDE.md": "# Agent instructions\n",
      },
    });
    const project = await registerProject.run({
      root,
      verifyCommand: "pnpm test",
      workingExportFolder: ".scratch",
    });
    const session = await aSession({ projectId: project.id });
    const interviewer = useScenario(session.id, "scout-project");

    const scouted = await scoutProject.run({ sessionId: session.id });

    expect(interviewer.requests.map((request) => request.kind)).toEqual([
      "scout-project",
    ]);
    expect(scouted.report?.result.proposedDecisions).toHaveLength(2);
    expect(scouted.report?.result.currentState).toHaveLength(1);
    expect(interviewer.remainingFor(session.id)).toBe(0);
  });
});
