import { randomUUID } from "node:crypto";

import { defineAction, fail } from "@agent-native/core/action";
import { eq } from "@agent-native/core/db/schema";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { describeDecisions } from "../server/tree.js";

export default defineAction({
  description:
    "Accept the supersession proposed on a loose end: the answer the interviewer found in a later settled decision becomes this decision's own answer, and it settles. The steering move it held moves to history, carrying the interviewer's reason for the supersession. Refuses a decision with no supersession pending.",
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

    if (!row.supersededById) {
      fail(
        `"${row.questionTitle}" has no supersession to accept: no settled decision has been proposed as already answering it.`,
        { errorCode: "no-supersession", statusCode: 409 },
      );
    }

    const now = new Date().toISOString();

    await db.insert(schema.decisionHistory).values({
      id: randomUUID(),
      decisionId: row.id,
      questionTitle: row.questionTitle,
      questionBody: row.questionBody,
      answer: row.currentAnswer,
      answerKind: row.answerKind,
      // Why this answer was superseded is the interviewer's own reasoning, so
      // it belongs in the same column a stale review's verdict writes to.
      interviewerReason: row.supersessionReason,
      recordedAt: now,
    });

    const [updated] = await db
      .update(schema.decisions)
      .set({
        currentAnswer: row.supersessionAnswer ?? "",
        answerKind: "own-answer",
        settledAt: now,
        supersededById: null,
        supersessionAnswer: null,
        supersessionReason: null,
        updatedAt: now,
      })
      .where(eq(schema.decisions.id, decisionId))
      .returning();

    if (!updated) fail("Failed to accept the supersession.", { statusCode: 500 });

    return describeDecisions([updated])[0];
  },
});
