import { defineAction, fail } from "@agent-native/core/action";
import { eq, inArray } from "@agent-native/core/db/schema";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { runDueStaleReviews } from "../server/stale-review.js";
import requestNextRound from "./request-next-round.js";

export default defineAction({
  description:
    "Submit an open round: every card's draft becomes its decision's answer, the decisions settle, and the interviewer is asked for the next round. Refuses a round that still has unanswered cards.",
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

    const now = new Date().toISOString();

    for (const placement of placements) {
      await db
        .update(schema.decisions)
        .set({
          currentAnswer: placement.draftAnswer,
          answerKind: placement.draftAnswerKind,
          settledAt: now,
          reopenedAt: null,
          updatedAt: now,
        })
        .where(eq(schema.decisions.id, placement.decisionId));
    }

    await db
      .update(schema.rounds)
      .set({ submissionState: "submitted", submittedAt: now })
      .where(eq(schema.rounds.id, id));

    await runDueStaleReviews({
      sessionId: round.sessionId,
      submittedRoundId: id,
    });

    return requestNextRound.run({ sessionId: round.sessionId });
  },
});
