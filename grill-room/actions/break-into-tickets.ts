import { randomUUID } from "node:crypto";

import { defineAction, fail } from "@agent-native/core/action";
import { eq, inArray } from "@agent-native/core/db/schema";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { getInterviewer } from "../server/interviewer/index.js";
import type { BreakIntoTicketsResult } from "../server/interviewer/index.js";
import { validateTicketSet } from "../server/tickets.js";
import {
  askUntilAccepted,
  decisionSnapshots,
  failIfTurnInProgress,
  MAX_TURN_RETRIES,
  runTurn,
  TurnRejected,
} from "../server/turn.js";
import listTickets from "./list-tickets.js";

export default defineAction({
  description:
    "Break the session's current spec into implementation tickets, replacing any tickets already on the session. Allowed only for a confirmed session with a current spec and no turn already working. Refuses to replace tickets that carry a build record unless `force` is set, since replacing a ticket cascades to delete its build record.",
  schema: z.object({
    sessionId: z.string().min(1).describe("Session id"),
    force: z
      .boolean()
      .default(false)
      .describe(
        "Replace the session's tickets even though doing so would delete a build record",
      ),
  }),
  run: async ({ sessionId, force }) => {
    const db = getDb();

    const [session] = await db
      .select()
      .from(schema.sessions)
      .where(eq(schema.sessions.id, sessionId))
      .limit(1);

    if (!session) fail(`Session not found: ${sessionId}`, { statusCode: 404 });

    failIfTurnInProgress(
      session,
      "The interviewer is working on this session. Wait for the turn to finish before breaking the spec into tickets.",
    );

    if (session.state !== "confirmed") {
      fail(
        `Only a confirmed session can be broken into tickets. This session is ${session.state}.`,
        { errorCode: "not-confirmed", statusCode: 409 },
      );
    }

    const [spec] = await db
      .select()
      .from(schema.specs)
      .where(eq(schema.specs.sessionId, sessionId))
      .limit(1);

    if (!spec) {
      fail(
        "This session has no spec yet. Synthesize one before breaking it into tickets.",
        { errorCode: "spec-missing", statusCode: 409 },
      );
    }

    if (!spec.current) {
      fail(
        "The spec is out of date with the design tree. Regenerate it before breaking it into tickets.",
        { errorCode: "spec-not-current", statusCode: 409 },
      );
    }

    const existingTickets = await db
      .select()
      .from(schema.tickets)
      .where(eq(schema.tickets.sessionId, sessionId));

    if (existingTickets.length > 0 && !force) {
      const buildRecordRows = await db
        .select()
        .from(schema.buildRecords)
        .where(
          inArray(
            schema.buildRecords.ticketId,
            existingTickets.map((ticket) => ticket.id),
          ),
        );

      if (buildRecordRows.length > 0) {
        fail(
          `Replacing this session's tickets would delete ${buildRecordRows.length} build record${buildRecordRows.length === 1 ? "" : "s"}. Pass force to replace them anyway.`,
          {
            errorCode: "build-records-exist",
            statusCode: 409,
            details: { buildRecordCount: buildRecordRows.length },
          },
        );
      }
    }

    await runTurn({
      sessionId,
      failedMessage: "The interviewer turn failed.",
      record: { turnKind: "break-into-tickets", model: session!.model },
      take: async (recorder) => {
        const rows = await db
          .select()
          .from(schema.decisions)
          .where(eq(schema.decisions.sessionId, sessionId))
          // `createdAt` has millisecond precision; id as a final tie-break
          // keeps ticket generation input order deterministic when two
          // decisions land in the same millisecond.
          .orderBy(schema.decisions.createdAt, schema.decisions.id);

        const interviewer = getInterviewer();

        const accepted = await askUntilAccepted<BreakIntoTicketsResult>({
          conversationId: session!.conversationId,
          recorder,
          ask: async ({ conversationId, rejectionReason, observer }) =>
            interviewer.breakIntoTickets(
              {
                kind: "break-into-tickets",
                context: {
                  sessionId: session!.id,
                  idea: session!.idea,
                  title: session!.title,
                  model: session!.model,
                  answeringMode: session!.answeringMode,
                  docsFolder: session!.docsFolder,
                  conversationId,
                  decisions: await decisionSnapshots(rows),
                },
                specMarkdown: spec!.markdown,
                rejectionReason,
              },
              observer,
            ),
          reasonsToRefuse: (result) => validateTicketSet(result.tickets).reasons,
          exhausted: (lastReason) =>
            new TurnRejected(
              "invalid-tickets",
              `The interviewer proposed a ticket breakdown that does not validate ${MAX_TURN_RETRIES + 1} times. Last reason: ${lastReason}`,
            ),
        });

        const now = new Date().toISOString();
        const idByNumber = new Map(
          accepted.result.tickets.map((ticket) => [ticket.number, randomUUID()]),
        );

        // Cascades to the build records of the tickets being replaced; the
        // check above already refused this unless force was passed or there
        // was nothing to lose.
        await db.delete(schema.tickets).where(eq(schema.tickets.sessionId, sessionId));

        await db.insert(schema.tickets).values(
          accepted.result.tickets.map((ticket) => ({
            id: idByNumber.get(ticket.number) as string,
            sessionId,
            number: ticket.number,
            slug: ticket.slug,
            title: ticket.title,
            body: ticket.body,
            status: "ready" as const,
            blockedByJson: JSON.stringify(
              ticket.blockedBy.flatMap((number) => {
                const id = idByNumber.get(number);
                return id ? [id] : [];
              }),
            ),
            createdAt: now,
            updatedAt: now,
          })),
        );

        await db
          .update(schema.specs)
          .set({
            ticketsGeneratedAt: now,
            ticketsTurnId: recorder?.turnId ?? null,
          })
          .where(eq(schema.specs.sessionId, sessionId));

        return accepted.conversationId;
      },
    });

    return listTickets.run({ sessionId });
  },
});
