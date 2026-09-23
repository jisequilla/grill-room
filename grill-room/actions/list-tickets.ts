import { defineAction, fail } from "@agent-native/core/action";
import { eq } from "@agent-native/core/db/schema";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { computeWaves, describeTickets, ticketsAreCurrent } from "../server/tickets.js";

export default defineAction({
  description:
    "List a session's tickets in number order, each with its blockedBy numbers resolved, plus whether they are still current with the session's spec and the wave order derived from blockedBy.",
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
      .from(schema.tickets)
      .where(eq(schema.tickets.sessionId, sessionId))
      .orderBy(schema.tickets.number);

    const [spec] = await db
      .select()
      .from(schema.specs)
      .where(eq(schema.specs.sessionId, sessionId))
      .limit(1);

    const tickets = describeTickets(rows);
    // `validateTicketSet` already refuses a `blockedBy` cycle at generation
    // and edit time, so this is a defensive fallback, not the primary check:
    // a cyclic set (which should not happen) reports no waves rather than
    // throwing, since a read action should not fail on stored data it did
    // not just write.
    const wavesResult = computeWaves(tickets);

    return {
      tickets,
      ticketsCurrent: ticketsAreCurrent(spec ?? null),
      waves: wavesResult.ok ? wavesResult.waves : [],
    };
  },
});
