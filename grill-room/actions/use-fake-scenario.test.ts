import { afterEach, describe, expect, it } from "vitest";

import {
  fakeScenarios,
  getInterviewer,
  INTERVIEWER_ENV_VAR,
  resetInterviewer,
} from "../server/interviewer/index.js";
import {
  aContext,
  anAssessReadinessRequest,
  anAssessReadinessResult,
} from "../server/interviewer/test-fixtures.js";
import useFakeScenario from "./use-fake-scenario.js";

const TEST_SCENARIO = "use-fake-scenario-test";

afterEach(() => {
  delete fakeScenarios[TEST_SCENARIO];
  resetInterviewer();
  delete process.env[INTERVIEWER_ENV_VAR];
});

function selectFake() {
  process.env[INTERVIEWER_ENV_VAR] = "fake";
  resetInterviewer();
}

describe("use-fake-scenario", () => {
  it("serves the chosen scenario to that session only", async () => {
    selectFake();
    fakeScenarios[TEST_SCENARIO] = {
      turns: [
        {
          kind: "assess-readiness",
          result: anAssessReadinessResult({ verdict: "not-ready" }),
        },
      ],
    };

    await expect(
      useFakeScenario.run({ sessionId: "chosen", scenario: TEST_SCENARIO }),
    ).resolves.toEqual({ sessionId: "chosen", scenario: TEST_SCENARIO });

    const judged = await getInterviewer().assessReadiness(
      anAssessReadinessRequest({ context: aContext({ sessionId: "chosen" }) }),
    );
    expect(judged.result.verdict).toBe("not-ready");

    // A session that chose nothing still gets the canned interview, whose
    // first turn is a round proposal, not a readiness judgment.
    await expect(
      getInterviewer().assessReadiness(
        anAssessReadinessRequest({ context: aContext({ sessionId: "other" }) }),
      ),
    ).rejects.toThrow('but the request was "assess-readiness"');
  });

  it("is refused with fake-interviewer-only when the real interviewer is selected", async () => {
    await expect(
      useFakeScenario.run({ sessionId: "s", scenario: "canned-interview" }),
    ).rejects.toMatchObject({ errorCode: "fake-interviewer-only" });
  });

  it("refuses a scenario the fake does not have with unknown-scenario", async () => {
    selectFake();

    await expect(
      useFakeScenario.run({ sessionId: "s", scenario: "no-such-scenario" }),
    ).rejects.toMatchObject({ errorCode: "unknown-scenario" });
  });
});
