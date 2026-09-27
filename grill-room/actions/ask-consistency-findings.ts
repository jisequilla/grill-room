import { defineAction, fail } from "@agent-native/core/action";
import { eq, inArray } from "@agent-native/core/db/schema";
import { z } from "zod";

import {
  cardsAskable,
  decisionBody,
  listConsistencyFindings,
} from "../server/consistency.js";
import { getDb, schema } from "../server/db/index.js";
import type { ConsistencyPlace } from "../server/interviewer/index.js";
import { MAX_CONSISTENCY_FINDINGS } from "../server/interviewer/schemas.js";
import { failIfTurnInProgress } from "../server/turn.js";
import { addDecisionCore } from "./add-decision.js";

export default defineAction({
  description:
    "Ask one or more open reopen cards in the interview: each card's question is added as a decision awaiting the interviewer's placement, with its quotes, places and source decision in the body, and the card becomes `asked`, linked to that decision. The session returns to interviewing (clearing its done summary) and its spec goes not current, exactly as add-decision does; after confirming, re-synthesizing and breaking into tickets again, the check runs again. Several cards are asked in one call because the first ask sends the session back to the interview. Everything is one transaction: a failure part way adds nothing. Refused, writing nothing, with duplicate-finding, finding-not-found, mixed-sessions, turn-in-progress, not-open (a dismissed or already asked card) or card-outdated (the cards came from an earlier spec or breakdown). Returns what list-consistency-findings returns.",
  schema: z.object({
    findingIds: z
      .array(z.string().min(1))
      .min(1)
      .max(MAX_CONSISTENCY_FINDINGS)
      .describe("The reopen cards to ask, by id"),
  }),
  run: async ({ findingIds }) => {
    const db = getDb();

    const seen = new Set<string>();
    for (const id of findingIds) {
      if (seen.has(id)) {
        fail(`Finding ${id} is listed twice.`, {
          errorCode: "duplicate-finding",
          statusCode: 400,
        });
      }
      seen.add(id);
    }

    const rows = await db
      .select()
      .from(schema.consistencyFindings)
      .where(inArray(schema.consistencyFindings.id, findingIds));
    const byId = new Map(rows.map((row) => [row.id, row]));

    const unknown = findingIds.find((id) => !byId.has(id));
    if (unknown !== undefined) {
      fail(`Reopen card not found: ${unknown}`, {
        errorCode: "finding-not-found",
        statusCode: 404,
      });
    }

    const sessionIds = new Set(rows.map((row) => row.sessionId));
    if (sessionIds.size > 1) {
      fail(
        "These cards belong to more than one session. Ask one session's cards at a time.",
        { errorCode: "mixed-sessions", statusCode: 400 },
      );
    }
    const sessionId = rows[0]!.sessionId;

    const [session] = await db
      .select()
      .from(schema.sessions)
      .where(eq(schema.sessions.id, sessionId))
      .limit(1);
    if (!session) fail(`Session not found: ${sessionId}`, { statusCode: 404 });

    failIfTurnInProgress(
      session,
      "The interviewer is working on this session. Wait for the turn to finish before asking a card in the interview.",
    );

    const cards = [...rows].sort((a, b) => a.number - b.number);
    const closed = cards.find((card) => card.status !== "open");
    if (closed) {
      fail(`Finding ${closed.number} is already ${closed.status}.`, {
        errorCode: "not-open",
        statusCode: 409,
      });
    }

    const [spec] = await db
      .select()
      .from(schema.specs)
      .where(eq(schema.specs.sessionId, sessionId))
      .limit(1);
    if (!spec || !cardsAskable(spec)) {
      fail(
        "These cards came from an earlier spec or breakdown. Check the current tickets first.",
        { errorCode: "card-outdated", statusCode: 409 },
      );
    }

    await db.transaction(async (tx) => {
      for (const card of cards) {
        const decision = await addDecisionCore(
          {
            sessionId,
            title: card.question.trim(),
            body: decisionBody({
              kind: card.kind,
              at: JSON.parse(card.atJson) as ConsistencyPlace,
              against: card.againstJson
                ? (JSON.parse(card.againstJson) as ConsistencyPlace)
                : null,
              decisionKey: card.decisionKey,
            }),
          },
          tx,
        );
        await tx
          .update(schema.consistencyFindings)
          .set({
            status: "asked",
            decisionId: decision!.id,
            updatedAt: new Date().toISOString(),
          })
          .where(eq(schema.consistencyFindings.id, card.id));
      }
    });

    return listConsistencyFindings(sessionId);
  },
});
