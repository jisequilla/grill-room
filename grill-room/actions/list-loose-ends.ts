import { defineAction, fail } from "@agent-native/core/action";
import { eq } from "@agent-native/core/db/schema";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { classifyLooseEnds, describeDecisions, treeFacts } from "../server/tree.js";

export default defineAction({
  description:
    "List every loose end blocking confirmation of a session: a decision unknown, deferred, prototype flagged, or pushed back with no response yet; a decision derived stale or unplaced; and a decision never answered. Each decision carries a reason naming which category it falls under. Empty once every loose end has a real answer or a disposition.",
  schema: z.object({
    sessionId: z.string().min(1).describe("Session id"),
  }),
  http: { method: "GET" },
  run: async ({ sessionId }) => {
    const db = getDb();

    const [session] = await db
      .select()
      .from(schema.sessions)
      .where(eq(schema.sessions.id, sessionId))
      .limit(1);

    if (!session) fail(`Session not found: ${sessionId}`, { statusCode: 404 });

    const rows = await db
      .select()
      .from(schema.decisions)
      .where(eq(schema.decisions.sessionId, sessionId))
      // `createdAt` has millisecond precision; id as a final tie-break keeps
      // this deterministic when two decisions land in the same millisecond.
      .orderBy(schema.decisions.createdAt, schema.decisions.id);

    const reasons = classifyLooseEnds(treeFacts(rows));
    const views = describeDecisions(rows);

    return views.flatMap((view) => {
      const reason = reasons.get(view.id);
      return reason ? [{ ...view, reason }] : [];
    });
  },
});
