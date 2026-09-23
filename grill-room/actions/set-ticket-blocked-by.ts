import { defineAction, fail } from "@agent-native/core/action";
import { eq } from "@agent-native/core/db/schema";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { numbersOnCycles } from "../server/tickets.js";
import { parseStringArray } from "../server/tree.js";
import { failIfTurnInProgress } from "../server/turn.js";
import listTickets from "./list-tickets.js";

export default defineAction({
  description:
    "Edit which other tickets in the same session block a ticket, identified by ticketId with the new blockedBy given as ticket numbers (not ids). Refuses a number that is not a ticket in the session, a ticket naming itself, and an edit that would create a blocking cycle, each with a clear message. Returns the same shape as list-tickets.",
  schema: z.object({
    ticketId: z.string().min(1).describe("Ticket id"),
    blockedBy: z
      .array(z.number().int())
      .describe("The ticket numbers (not ids) that should block this ticket, replacing its current blockedBy"),
  }),
  run: async ({ ticketId, blockedBy }) => {
    const db = getDb();

    const [ticket] = await db
      .select()
      .from(schema.tickets)
      .where(eq(schema.tickets.id, ticketId))
      .limit(1);

    if (!ticket) fail(`Ticket not found: ${ticketId}`, { statusCode: 404 });

    const [session] = await db
      .select()
      .from(schema.sessions)
      .where(eq(schema.sessions.id, ticket!.sessionId))
      .limit(1);

    if (!session) fail(`Session not found: ${ticket!.sessionId}`, { statusCode: 404 });

    failIfTurnInProgress(
      session!,
      "The interviewer is working on this session. Wait for the turn to finish before editing ticket dependencies.",
    );

    const siblings = await db
      .select()
      .from(schema.tickets)
      .where(eq(schema.tickets.sessionId, ticket!.sessionId));

    const idByNumber = new Map(siblings.map((sibling) => [sibling.number, sibling.id]));

    const selfReference = blockedBy.includes(ticket!.number);
    if (selfReference) {
      fail(`Ticket ${ticket!.number} cannot block itself.`, {
        errorCode: "self-reference",
        statusCode: 400,
      });
    }

    const unknownNumbers = [...new Set(blockedBy)]
      .filter((number) => !idByNumber.has(number))
      .sort((a, b) => a - b);
    if (unknownNumbers.length > 0) {
      fail(
        `Ticket number${unknownNumbers.length === 1 ? "" : "s"} ${unknownNumbers.join(", ")} ${unknownNumbers.length === 1 ? "is" : "are"} not in this session.`,
        { errorCode: "unknown-ticket-number", statusCode: 400 },
      );
    }

    const byNumber = new Map(
      siblings.map((sibling) => [
        sibling.number,
        {
          blockedBy:
            sibling.id === ticketId
              ? [...new Set(blockedBy)]
              : parseStringArray(sibling.blockedByJson).flatMap((blockerId) => {
                  const blockerSibling = siblings.find((candidate) => candidate.id === blockerId);
                  return blockerSibling ? [blockerSibling.number] : [];
                }),
        },
      ]),
    );

    const cyclic = numbersOnCycles(byNumber).sort((a, b) => a - b);
    if (cyclic.length > 0) {
      fail(
        `Setting this would create a blocking cycle: ${cyclic.join(", ")}.`,
        { errorCode: "cycle", statusCode: 409, details: { cycle: cyclic } },
      );
    }

    const now = new Date().toISOString();
    await db
      .update(schema.tickets)
      .set({
        blockedByJson: JSON.stringify(
          [...new Set(blockedBy)].flatMap((number) => {
            const id = idByNumber.get(number);
            return id ? [id] : [];
          }),
        ),
        updatedAt: now,
      })
      .where(eq(schema.tickets.id, ticketId));

    return listTickets.run({ sessionId: ticket!.sessionId });
  },
});
