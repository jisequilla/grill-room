import { randomUUID } from "node:crypto";

import { defineAction, fail } from "@agent-native/core/action";
import { eq } from "@agent-native/core/db/schema";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import {
  CLEARED_ANSWER_LINKS,
  CLEARED_SUPERSESSION,
  describeDecisions,
} from "../server/tree.js";

export default defineAction({
  description:
    "Accept the deferral proposed on a settled own answer: the interviewer read it as postponing the question rather than deciding it. The own answer moves to history, carrying the interviewer's reason, and the decision becomes a deferred loose end, which blocks confirmation until it is resolved; the next round request asks it again as a new card, exactly as if the user had deferred it in a round. Refuses a decision with no deferral pending.",
  schema: z.object({
    decisionId: z.string().min(1).describe("Decision id"),
  }),
  run: async ({ decisionId }) => {
    const db = getDb();

    const [row] = await db
      .select()
      .from(schema.decisions)
      .where(eq(schema.decisions.id, decisionId))
      .limit(1);

    if (!row) fail(`Decision not found: ${decisionId}`, { statusCode: 404 });

    if (!row.deferralReason) {
      fail(
        `"${row.questionTitle}" has no deferral to accept: its answer has not been proposed as postponing the question.`,
        { errorCode: "no-deferral", statusCode: 409 },
      );
    }

    const now = new Date().toISOString();

    await db.insert(schema.decisionHistory).values({
      id: randomUUID(),
      decisionId: row.id,
      questionTitle: row.questionTitle,
      questionBody: row.questionBody,
      answer: row.currentAnswer,
      answerKind: "own-answer",
      // Why the answer reads as a deferral is the interviewer's own reasoning,
      // the same column an accepted supersession writes its reason to.
      interviewerReason: row.deferralReason,
      recordedAt: now,
    });

    // The text stays for now: it is what the owner wrote, and the round that
    // asks the decision again records it to history before clearing it. The
    // answer kind changes, so the links and any proposal about the settled
    // answer go with it, as every other write that changes the answer does.
    const [updated] = await db
      .update(schema.decisions)
      .set({
        answerKind: "deferred",
        settledAt: null,
        deferralReason: null,
        ...CLEARED_ANSWER_LINKS,
        ...CLEARED_SUPERSESSION,
        updatedAt: now,
      })
      .where(eq(schema.decisions.id, decisionId))
      .returning();

    if (!updated) fail("Failed to accept the deferral.", { statusCode: 500 });

    return describeDecisions([updated])[0];
  },
});
