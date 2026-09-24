import { defineAction, fail } from "@agent-native/core/action";
import { z } from "zod";

import {
  fakeScenarios,
  INTERVIEWER_ENV_VAR,
  isFakeScenario,
  selectedFakeInterviewer,
} from "../server/interviewer/index.js";

export default defineAction({
  description: `Test only: choose the fake interviewer's scripted scenario for one session, replacing any queue the session already has. Works only when ${INTERVIEWER_ENV_VAR}=fake; refused with fake-interviewer-only otherwise, and with unknown-scenario for a name the fake does not have.`,
  schema: z.object({
    sessionId: z.string().min(1).describe("Session id"),
    scenario: z.string().min(1).describe("Name of a fake interviewer scenario"),
  }),
  run: async ({ sessionId, scenario }) => {
    const fake = selectedFakeInterviewer();
    if (!fake) {
      fail(
        `Scenarios exist only for the fake interviewer. Set ${INTERVIEWER_ENV_VAR}=fake to use one.`,
        { errorCode: "fake-interviewer-only", statusCode: 409 },
      );
    }

    if (!isFakeScenario(scenario)) {
      fail(
        `No fake interviewer scenario named "${scenario}". Known: ${Object.keys(fakeScenarios).join(", ")}.`,
        { errorCode: "unknown-scenario", statusCode: 400 },
      );
    }

    fake.useScenario(sessionId, scenario);
    return { sessionId, scenario };
  },
});
