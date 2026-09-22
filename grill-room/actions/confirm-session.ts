import { defineAction, fail } from "@agent-native/core/action";
import { eq } from "@agent-native/core/db/schema";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { classifyLooseEnds, describeDecisions, treeFacts } from "../server/tree.js";
import { failIfTurnInProgress } from "../server/turn.js";

export default defineAction({
  description:
    "Confirm a session whose done proposal is pending: allowed only in state done-proposed, and only once every loose end has a real answer or a disposition. Refuses with the list of loose ends still open, refuses while a turn is working, and otherwise moves the session to confirmed.",
  schema: z.object({
    sessionId: z.string().min(1).describe("Session id"),
  }),
  run: async ({ sessionId }) => {
    const db = getDb();

    const [session] = await db
      .select()
      .from(schema.sessions)
      .where(eq(schema.sessions.id, sessionId))
      .limit(1);

    if (!session) fail(`Session not found: ${sessionId}`, { statusCode: 404 });

    failIfTurnInProgress(
      session,
      "The interviewer is working on this session. Wait for the turn to finish before confirming.",
    );

    if (session.state !== "done-proposed") {
      fail(
        `Only a session with a pending done proposal can be confirmed. This session is ${session.state}.`,
        { errorCode: "not-done-proposed", statusCode: 409 },
      );
    }

    const rows = await db
      .select()
      .from(schema.decisions)
      .where(eq(schema.decisions.sessionId, sessionId))
      // `createdAt` has millisecond precision; id as a final tie-break keeps
      // this deterministic when two decisions land in the same millisecond.
      .orderBy(schema.decisions.createdAt, schema.decisions.id);

    const reasons = classifyLooseEnds(treeFacts(rows));

    if (reasons.size > 0) {
      const looseEnds = describeDecisions(rows).flatMap((view) => {
        const reason = reasons.get(view.id);
        return reason ? [{ ...view, reason }] : [];
      });
      fail(
        `${looseEnds.length} loose end${looseEnds.length === 1 ? "" : "s"} still block confirmation: ${looseEnds
          .map((end) => `"${end.questionTitle}"`)
          .join(", ")}.`,
        {
          errorCode: "loose-ends-remain",
          statusCode: 409,
          details: { looseEnds },
        },
      );
    }

    const now = new Date().toISOString();
    const [updated] = await db
      .update(schema.sessions)
      .set({ state: "confirmed", updatedAt: now })
      .where(eq(schema.sessions.id, sessionId))
      .returning();

    if (!updated) fail("Failed to confirm the session.", { statusCode: 500 });

    return updated;
  },
});
