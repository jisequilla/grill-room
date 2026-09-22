import { randomUUID } from "node:crypto";

import { defineAction, fail } from "@agent-native/core/action";
import { and, eq } from "@agent-native/core/db/schema";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { TICKET_STATUSES } from "../server/db/schema.js";

export default defineAction({
  description:
    'Create or edit a ticket\'s build record, so the outcome of building it is kept with the ticket. Identify the ticket either by `ticketId`, or by the pair `sessionId` + `ticketNumber` (what an orchestrating agent knows from the exported ticket file name) — refuses when neither or both forms are given, or when the ticket does not exist. Upserts the ticket\'s single build record: on edit, every field is replaced except `createdAt`. `model` is free text and required (builds may use models the app does not know). Optionally pass `ticketStatus` to update the ticket\'s status in the same call. Returns the record together with its ticket\'s number, slug, title and status.',
  schema: z.object({
    ticketId: z.string().min(1).optional().describe("Ticket id. Alternative to sessionId + ticketNumber."),
    sessionId: z
      .string()
      .min(1)
      .optional()
      .describe("Session id. Used with ticketNumber as an alternative to ticketId."),
    ticketNumber: z
      .coerce.number()
      .int()
      .optional()
      .describe("Ticket number within the session. Used with sessionId as an alternative to ticketId."),
    model: z
      .string()
      .min(1)
      .describe("The model that built the ticket, free text (e.g. \"sonnet\", \"claude-opus-4-1\"). Required, trimmed, non-empty."),
    firstAttemptPassed: z
      .boolean()
      .describe("Whether the first attempt passed verification."),
    escalated: z
      .boolean()
      .default(false)
      .describe("Whether the build was escalated to a stronger model. Defaults to false."),
    promptMissing: z
      .string()
      .default("")
      .describe("What the delegation prompt was missing, if anything. Defaults to empty."),
    notes: z.string().default("").describe("Free notes. Defaults to empty."),
    ticketStatus: z
      .enum(TICKET_STATUSES)
      .optional()
      .describe(
        `When given, also updates the ticket's status in the same call: one of ${TICKET_STATUSES.join(", ")}.`,
      ),
  }),
  run: async ({
    ticketId,
    sessionId,
    ticketNumber,
    model,
    firstAttemptPassed,
    escalated,
    promptMissing,
    notes,
    ticketStatus,
  }) => {
    const db = getDb();

    const hasTicketId = ticketId !== undefined;
    const hasSessionPair = sessionId !== undefined && ticketNumber !== undefined;

    if (hasTicketId === hasSessionPair) {
      fail(
        "Identify the ticket with either ticketId, or the pair sessionId and ticketNumber — not both and not neither.",
        { errorCode: "invalid-ticket-reference", statusCode: 400 },
      );
    }

    const trimmedModel = model.trim();
    if (trimmedModel === "") {
      fail("model is required.", { errorCode: "empty_model", statusCode: 400 });
    }

    const [ticket] = hasTicketId
      ? await db.select().from(schema.tickets).where(eq(schema.tickets.id, ticketId!)).limit(1)
      : await db
          .select()
          .from(schema.tickets)
          .where(
            and(
              eq(schema.tickets.sessionId, sessionId!),
              eq(schema.tickets.number, ticketNumber!),
            ),
          )
          .limit(1);

    if (!ticket) {
      fail(
        hasTicketId
          ? `Ticket not found: ${ticketId}`
          : `Ticket not found: session ${sessionId}, number ${ticketNumber}`,
        { errorCode: "ticket_not_found", statusCode: 404 },
      );
    }

    const now = new Date().toISOString();

    let ticketRow = ticket!;
    if (ticketStatus !== undefined && ticketStatus !== ticketRow.status) {
      const [updatedTicket] = await db
        .update(schema.tickets)
        .set({ status: ticketStatus, updatedAt: now })
        .where(eq(schema.tickets.id, ticketRow.id))
        .returning();
      ticketRow = updatedTicket ?? ticketRow;
    }

    const [existingRecord] = await db
      .select()
      .from(schema.buildRecords)
      .where(eq(schema.buildRecords.ticketId, ticketRow.id))
      .limit(1);

    const fields = {
      model: trimmedModel,
      firstAttemptPassed,
      escalated,
      promptMissing,
      notes,
      updatedAt: now,
    };

    const [record] = existingRecord
      ? await db
          .update(schema.buildRecords)
          .set(fields)
          .where(eq(schema.buildRecords.id, existingRecord.id))
          .returning()
      : await db
          .insert(schema.buildRecords)
          .values({
            id: randomUUID(),
            ticketId: ticketRow.id,
            ...fields,
            createdAt: now,
          })
          .returning();

    if (!record) fail("Failed to save the build record.", { statusCode: 500 });

    return {
      ...record,
      ticket: {
        number: ticketRow.number,
        slug: ticketRow.slug,
        title: ticketRow.title,
        status: ticketRow.status,
      },
    };
  },
});
