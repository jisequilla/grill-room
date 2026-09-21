import { randomUUID } from "node:crypto";

import { defineAction, fail } from "@agent-native/core/action";
import { and, desc, eq } from "@agent-native/core/db/schema";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { deriveTreeStates, treeFacts } from "../server/tree.js";
import { failIfTurnInProgress } from "../server/turn.js";
import getCurrentRound from "./get-current-round.js";

/**
 * The moment of the reopen, which must fall strictly after every answer it puts
 * in doubt: staleness is a comparison of timestamps, and a whole interview can
 * run inside one millisecond when something other than a person drives it.
 */
function reopenStamp(rows: readonly { settledAt: string | null }[]): string {
  const settled = rows
    .map((row) => (row.settledAt ? Date.parse(row.settledAt) : 0))
    .filter((ms) => Number.isFinite(ms));
  const latest = settled.length > 0 ? Math.max(...settled) : 0;

  return new Date(Math.max(Date.now(), latest + 1)).toISOString();
}

export default defineAction({
  description:
    "Reopen a settled decision: its answer becomes history, the decision returns to the frontier, and every decision downstream of it is marked stale. The question is put straight back to the user, as a new card on the open round or a round of its own. Allowed in any session state; a session that had proposed or confirmed done returns to interviewing.",
  schema: z.object({
    decisionId: z.string().min(1).describe("Decision id"),
  }),
  run: async ({ decisionId }) => {
    const db = getDb();

    const [decision] = await db
      .select()
      .from(schema.decisions)
      .where(eq(schema.decisions.id, decisionId))
      .limit(1);

    if (!decision) {
      fail(`Decision not found: ${decisionId}`, { statusCode: 404 });
    }

    const sessionId = decision.sessionId;

    const [session] = await db
      .select()
      .from(schema.sessions)
      .where(eq(schema.sessions.id, sessionId))
      .limit(1);

    if (!session) fail(`Session not found: ${sessionId}`, { statusCode: 404 });

    failIfTurnInProgress(
      session,
      "The interviewer is working on this session. Wait for the turn to finish before reopening a decision.",
    );

    const rows = await db
      .select()
      .from(schema.decisions)
      .where(eq(schema.decisions.sessionId, sessionId))
      .orderBy(schema.decisions.createdAt);

    const state = deriveTreeStates(treeFacts(rows)).get(decisionId);

    if (state !== "settled" && state !== "stale") {
      fail(
        `Only a decision that has been settled can be reopened. "${decision.questionTitle}" is ${state ?? "unknown"}.`,
        { errorCode: "decision-not-settled", statusCode: 409 },
      );
    }

    const now = reopenStamp(rows);

    await db.insert(schema.decisionHistory).values({
      id: randomUUID(),
      decisionId,
      questionTitle: decision.questionTitle,
      questionBody: decision.questionBody,
      answer: decision.currentAnswer,
      answerKind: decision.answerKind,
      recordedAt: now,
    });

    // `reopenedAt` is the whole of what makes the dependents stale: derivation
    // compares it against each of their `settledAt`, so nothing downstream is
    // written here.
    await db
      .update(schema.decisions)
      .set({
        currentAnswer: null,
        answerKind: null,
        dispositionTarget: null,
        settledAt: null,
        reopenedAt: now,
        updatedAt: now,
      })
      .where(eq(schema.decisions.id, decisionId));

    if (session.state !== "interviewing") {
      await db
        .update(schema.sessions)
        .set({ state: "interviewing", doneSummary: null, updatedAt: now })
        .where(eq(schema.sessions.id, sessionId));

      // A spec built from the old answer is out of date the moment it is
      // reopened. Tickets carry no such flag yet; that is a later ticket's
      // concern.
      if (session.state === "confirmed") {
        await db
          .update(schema.specs)
          .set({ current: false, updatedAt: now })
          .where(eq(schema.specs.sessionId, sessionId));
      }
    }

    const [open] = await db
      .select()
      .from(schema.rounds)
      .where(
        and(
          eq(schema.rounds.sessionId, sessionId),
          eq(schema.rounds.submissionState, "open"),
        ),
      )
      .orderBy(desc(schema.rounds.createdAt))
      .limit(1);

    // The user reopened it to answer it differently, so it is asked straight
    // away. No interviewer turn: the question is the one already in the tree,
    // and what the change costs downstream is judged once the new answer is in.
    let roundId = open?.id;
    let sortOrder = 0;

    if (roundId) {
      const placements = await db
        .select()
        .from(schema.roundDecisions)
        .where(eq(schema.roundDecisions.roundId, roundId));
      sortOrder = placements.length;
    } else {
      roundId = randomUUID();
      await db.insert(schema.rounds).values({
        id: roundId,
        sessionId,
        submissionState: "open",
        createdAt: now,
      });
    }

    await db.insert(schema.roundDecisions).values({
      id: randomUUID(),
      roundId,
      decisionId,
      sortOrder,
    });

    return getCurrentRound.run({ sessionId });
  },
});
