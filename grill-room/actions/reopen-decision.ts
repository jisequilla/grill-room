import { randomUUID } from "node:crypto";

import { defineAction, fail } from "@agent-native/core/action";
import { and, desc, eq } from "@agent-native/core/db/schema";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { laterTimestamp } from "../server/ordering.js";
import { returnSessionToInterviewing } from "../server/session-state.js";
import {
  CLEARED_ANSWER_LINKS,
  deriveTreeStates,
  treeFacts,
} from "../server/tree.js";
import { failIfTurnInProgress } from "../server/turn.js";
import getCurrentRound from "./get-current-round.js";

/**
 * The moment of the reopen, which must fall strictly after every answer it puts
 * in doubt: staleness is a comparison of timestamps, and a whole interview can
 * run inside one millisecond when something other than a person drives it.
 */
function reopenStamp(rows: readonly { settledAt: string | null }[]): string {
  return laterTimestamp(...rows.map((row) => row.settledAt));
}

/**
 * Reopen one settled decision, and return the round its question now sits on.
 *
 * The action below is this and nothing else. It is exported because a batch of
 * reopens (`server/reopen-batch.ts`) applies the same reopen to each of its
 * items, and a second copy of this would be a second set of rules about what a
 * reopen does to history, to supersessions, and to a session that had finished.
 */
export async function reopenDecisionCore(
  decisionId: string,
): Promise<Awaited<ReturnType<typeof getCurrentRound.run>>> {
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
    // `createdAt` has millisecond precision; id as a final tie-break keeps
    // this deterministic when two decisions land in the same millisecond.
    .orderBy(schema.decisions.createdAt, schema.decisions.id);

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
      ...CLEARED_ANSWER_LINKS,
      updatedAt: now,
    })
    .where(eq(schema.decisions.id, decisionId));

  // A supersession is the claim that this decision, as settled, already
  // answers a loose end. It no longer is settled, so the claim goes with it.
  await db
    .update(schema.decisions)
    .set({
      supersededById: null,
      supersessionAnswer: null,
      supersessionReason: null,
      updatedAt: now,
    })
    .where(eq(schema.decisions.supersededById, decisionId));

  // Nor does it still replace anything: the decisions it replaced read as
  // current again. A loose end it settled keeps `settledById`, which records
  // where that answer came from rather than a claim about this one.
  await db
    .update(schema.decisions)
    .set({ replacedById: null, replacedReason: null, updatedAt: now })
    .where(eq(schema.decisions.replacedById, decisionId));

  if (session.state !== "interviewing") {
    await returnSessionToInterviewing(session, now);
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
    // Only one round is ever "open" at a time, so this tie-break is
    // defensive rather than load-bearing: total order still costs nothing.
    .orderBy(desc(schema.rounds.createdAt), schema.rounds.id)
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
}

export default defineAction({
  description:
    "Reopen a settled decision: its answer becomes history, the decision returns to the frontier, and every decision downstream of it is marked stale. The question is put straight back to the user, as a new card on the open round or a round of its own. Allowed in any session state; a session that had proposed or confirmed done returns to interviewing.",
  schema: z.object({
    decisionId: z.string().min(1).describe("Decision id"),
  }),
  run: ({ decisionId }) => reopenDecisionCore(decisionId),
});
