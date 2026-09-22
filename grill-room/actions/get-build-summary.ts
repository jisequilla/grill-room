import { defineAction, fail } from "@agent-native/core/action";
import { eq, inArray } from "@agent-native/core/db/schema";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";

export default defineAction({
  description:
    "Summarize a session's build records across its tickets: first-attempt pass rate and escalations at a glance, broken down by model, plus every ticket of the session with its build record or null. One call feeds the whole build records UI table.",
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

    const ticketRows = await db
      .select()
      .from(schema.tickets)
      .where(eq(schema.tickets.sessionId, sessionId))
      .orderBy(schema.tickets.number);

    const ticketIds = ticketRows.map((ticket) => ticket.id);
    const buildRecordRows =
      ticketIds.length === 0
        ? []
        : await db
            .select()
            .from(schema.buildRecords)
            .where(inArray(schema.buildRecords.ticketId, ticketIds));

    const buildRecordByTicketId = new Map(
      buildRecordRows.map((record) => [record.ticketId, record]),
    );

    const records = ticketRows.map((ticket) => ({
      ticket: {
        number: ticket.number,
        slug: ticket.slug,
        title: ticket.title,
        status: ticket.status,
      },
      buildRecord: buildRecordByTicketId.get(ticket.id) ?? null,
    }));

    const recorded = buildRecordRows.length;
    const firstAttemptPassedCount = buildRecordRows.filter(
      (record) => record.firstAttemptPassed === true,
    ).length;
    const escalatedCount = buildRecordRows.filter(
      (record) => record.escalated === true,
    ).length;

    const statsByModel = new Map<
      string,
      { recorded: number; firstAttemptPassed: number; escalated: number }
    >();
    for (const record of buildRecordRows) {
      const modelKey = record.model ?? "";
      const bucket = statsByModel.get(modelKey) ?? {
        recorded: 0,
        firstAttemptPassed: 0,
        escalated: 0,
      };
      bucket.recorded += 1;
      if (record.firstAttemptPassed === true) bucket.firstAttemptPassed += 1;
      if (record.escalated === true) bucket.escalated += 1;
      statsByModel.set(modelKey, bucket);
    }
    const byModel = [...statsByModel.entries()]
      .map(([model, stats]) => ({ model, ...stats }))
      .sort((a, b) => a.model.localeCompare(b.model));

    return {
      tickets: ticketRows.length,
      recorded,
      firstAttemptPassed: firstAttemptPassedCount,
      firstAttemptPassRate: recorded === 0 ? null : firstAttemptPassedCount / recorded,
      escalated: escalatedCount,
      byModel,
      records,
    };
  },
});
