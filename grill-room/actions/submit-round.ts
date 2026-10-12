import { defineAction, fail } from "@agent-native/core/action";
import { eq, inArray } from "@agent-native/core/db/schema";
import { z } from "zod";

import { settle } from "../server/answer-change.js";
import { getDb, schema } from "../server/db/index.js";
import { failIfTurnInProgress } from "../server/turn.js";
import requestNextRound from "./request-next-round.js";

export default defineAction({
  description:
    "Submit an open round: every card's draft becomes its decision's answer, the decisions settle, and the interviewer is asked for the next round. A decision that had an answer records it in history, the claims other decisions make about it are withdrawn, and the session's spec, if it has one, is marked not current; the whole submission lands in one transaction. Refuses a round that still has unanswered cards, and refuses while an interviewer turn is working.",
  schema: z.object({
    id: z.string().min(1).describe("Round id"),
  }),
  run: async ({ id }) => {
    const db = getDb();

    const [round] = await db
      .select()
      .from(schema.rounds)
      .where(eq(schema.rounds.id, id))
      .limit(1);

    if (!round) fail(`Round not found: ${id}`, { statusCode: 404 });

    if (round.submissionState === "submitted") {
      fail("That round has already been submitted.", {
        errorCode: "round_already_submitted",
        statusCode: 409,
      });
    }

    const placements = await db
      .select()
      .from(schema.roundDecisions)
      .where(eq(schema.roundDecisions.roundId, id))
      .orderBy(schema.roundDecisions.sortOrder);

    const unanswered = placements.filter(
      (placement) => placement.draftAnswerKind === null,
    );

    if (unanswered.length > 0) {
      const titles = await db
        .select({ title: schema.decisions.questionTitle })
        .from(schema.decisions)
        .where(
          inArray(
            schema.decisions.id,
            unanswered.map((placement) => placement.decisionId),
          ),
        );

      fail(
        `Answer every card before submitting the round. Still open: ${titles
          .map((row) => row.title)
          .join(", ")}.`,
        { errorCode: "round_incomplete", statusCode: 409 },
      );
    }

    // The foreign key guarantees the round's session exists.
    const [session] = await db
      .select()
      .from(schema.sessions)
      .where(eq(schema.sessions.id, round.sessionId))
      .limit(1);

    failIfTurnInProgress(
      session!,
      "The interviewer is working on this session. Wait for the turn to finish before submitting a round.",
    );

    const now = new Date().toISOString();

    // The whole submission lands together or not at all: every card's answer
    // and the round's own submitted state.
    await db.transaction(async (tx) => {
      for (const placement of placements) {
        // A steering move (unknown, pushed back, deferred, prototype flagged)
        // is a real answer but does not settle the decision: everything
        // downstream stays blocked until it is resolved into one that does.
        //
        // `reopenedAt` is left alone. Answering a reopened decision does not
        // undo the reopen: what hangs off it stays stale until the review
        // gives each dependent a later `settledAt` or takes its answer away.
        await settle(
          placement.decisionId,
          { answer: placement.draftAnswer, kind: placement.draftAnswerKind! },
          { now, db: tx },
        );
      }

      await tx
        .update(schema.rounds)
        .set({ submissionState: "submitted", submittedAt: now })
        .where(eq(schema.rounds.id, id));
    });

    // The stale review runs inside `request-next-round`, ahead of the
    // proposal: a reopened decision can also get its real answer outside a
    // round, through `answer-decision`, and that path has no round to submit.
    return requestNextRound.run({ sessionId: round.sessionId });
  },
});
