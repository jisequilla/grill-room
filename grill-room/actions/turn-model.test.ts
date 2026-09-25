import { eq } from "@agent-native/core/db/schema";
import { afterEach, describe, expect, it } from "vitest";

import { resetInterviewer, scriptInterviewer } from "../server/interviewer/index.js";
import { getDb, schema, useTestDatabase } from "../test/db.js";
import createSession from "./create-session.js";
import requestNextRound from "./request-next-round.js";

/**
 * Proves the "Turn launch reads the row" decision from
 * `.grill-room/change-a-session-s-model-before-its-first-round/spec.md`: the
 * start-turn path reads the session's model from the row at the moment it
 * launches the interviewer, so a model changed before the first round is the
 * model the interviewer actually receives.
 *
 * The change here is made directly against the row rather than through an
 * action, simulating a pre-first-round change; the real set-session-model
 * action is a later ticket.
 */
describe("turn launch reads the session's current model", () => {
  useTestDatabase();
  afterEach(resetInterviewer);

  it("uses the model on the row at launch time, not the model the session was created with", async () => {
    const session = await createSession.run({
      title: "Grill Room",
      idea: "A local app that grills me about an idea until it is decided.",
      model: "fable",
    });
    expect(session.model).toBe("fable");

    const db = getDb();
    await db
      .update(schema.sessions)
      .set({ model: "sonnet" })
      .where(eq(schema.sessions.id, session.id));

    const interviewer = scriptInterviewer([
      {
        kind: "propose-round",
        result: {
          proposedDecisions: [
            {
              key: "shape",
              title: "What shape should this take?",
              body: "The first thing to settle.",
              choices: [
                { label: "A single page", rationale: "Cheapest to build." },
                { label: "A workspace", rationale: "More layout to get right." },
              ],
              recommendedChoice: 1,
              recommendedAnswer: "A workspace",
              dependsOn: [],
              ask: true,
            },
          ],
          pushBackResponses: [],
          userDecisionPlacements: [],
          done: null,
        },
      },
    ]);

    const result = await requestNextRound.run({ sessionId: session.id });

    expect(result.turnStatus).toBe("idle");
    expect(result.turnError).toBeNull();
    expect(interviewer.requests).toHaveLength(1);
    expect(interviewer.requests[0]?.context.model).toBe("sonnet");
  });
});
