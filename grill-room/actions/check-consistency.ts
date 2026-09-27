import { defineAction, fail } from "@agent-native/core/action";
import { eq } from "@agent-native/core/db/schema";
import { z } from "zod";

import { runConsistencyTurn, tooManyTicketsMessage } from "../server/consistency.js";
import { getDb, schema } from "../server/db/index.js";
import { MAX_HANDOFF_SCOUT_TICKETS } from "../server/interviewer/index.js";
import { ticketsAreCurrent } from "../server/tickets.js";
import { failIfTurnInProgress } from "../server/turn.js";
import listConsistencyFindings from "./list-consistency-findings.js";

export default defineAction({
  description:
    "Check a session's spec and tickets for what they leave a builder to decide alone — a threshold with no number, a rule stated for one case, a spec and a ticket that disagree, an open choice, a value called defined with no value, a target named only by its role — and store each finding as a reopen card with one question for the owner, replacing the session's earlier cards (a dismissed card stays dismissed when the same finding recurs). Every quote is checked against the spec section or ticket it names. Runs automatically after every successful break-into-tickets; this repeats it on demand, as a turn of its own on the session's model, leaving the session's conversation untouched. Refused, before any turn, with not-confirmed, spec-missing, no-tickets, tickets-not-current, turn-in-progress, or too-many-tickets above 40 tickets. Returns what list-consistency-findings returns.",
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
      "The interviewer is working on this session. Wait for the turn to finish before checking its spec and tickets.",
    );

    if (session.state !== "confirmed") {
      fail(
        `Only a confirmed session's spec and tickets can be checked. This session is ${session.state}.`,
        { errorCode: "not-confirmed", statusCode: 409 },
      );
    }

    const [spec] = await db
      .select()
      .from(schema.specs)
      .where(eq(schema.specs.sessionId, sessionId))
      .limit(1);

    if (!spec) {
      fail("This session has no spec yet. Synthesize one and break it into tickets first.", {
        errorCode: "spec-missing",
        statusCode: 409,
      });
    }

    const tickets = await db
      .select({ id: schema.tickets.id })
      .from(schema.tickets)
      .where(eq(schema.tickets.sessionId, sessionId));

    if (tickets.length === 0) {
      fail("This session has no tickets yet. Break the spec into tickets first.", {
        errorCode: "no-tickets",
        statusCode: 409,
      });
    }

    if (!ticketsAreCurrent(spec)) {
      fail("Break the current spec into tickets before checking them.", {
        errorCode: "tickets-not-current",
        statusCode: 409,
      });
    }

    if (tickets.length > MAX_HANDOFF_SCOUT_TICKETS) {
      fail(tooManyTicketsMessage(tickets.length, MAX_HANDOFF_SCOUT_TICKETS, false), {
        errorCode: "too-many-tickets",
        statusCode: 409,
      });
    }

    await runConsistencyTurn(sessionId);

    return listConsistencyFindings.run({ sessionId });
  },
});
