import { randomUUID } from "node:crypto";

import { defineAction, fail } from "@agent-native/core/action";
import { eq } from "@agent-native/core/db/schema";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { describeDecisions, isSettlingAnswerKind } from "../server/tree.js";

export default defineAction({
  description:
    "Accept the supersession proposed on a decision. On a loose end, the answer the interviewer found in a later settled decision becomes this decision's own answer, and it settles; the steering move it held moves to history, carrying the interviewer's reason, and the decision keeps a lasting link to the one that settled it. On a settled decision a later one replaced, the answer is left as it was and the decision gains a lasting link to its replacement, with the interviewer's reason. Refuses a decision with no supersession pending.",
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

    // A settled decision a later one replaced keeps its answer: the owner
    // accepted that it is out of date, not a new answer for it. What it gains
    // is the lasting link that marks it replaced, for the export to read.
    if (isSettlingAnswerKind(row.answerKind)) {
      const [replaced] = await db
        .update(schema.decisions)
        .set({
          replacedById: row.supersededById,
          replacedReason: row.supersessionReason,
          supersededById: null,
          supersessionAnswer: null,
          supersessionReason: null,
          updatedAt: now,
        })
        .where(eq(schema.decisions.id, decisionId))
        .returning();

      if (!replaced) {
        fail("Failed to accept the supersession.", { statusCode: 500 });
      }

      return describeDecisions([replaced])[0];
    }

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
        settledById: row.supersededById,
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
