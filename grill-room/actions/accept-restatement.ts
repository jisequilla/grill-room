import { randomUUID } from "node:crypto";

import { defineAction, fail } from "@agent-native/core/action";
import { eq } from "@agent-native/core/db/schema";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { markSpecNotCurrent } from "../server/session-state.js";
import { CLEARED_RESTATEMENT, describeDecisions } from "../server/tree.js";
import { withdrawSupersessionsNaming } from "../server/withdraw-claims.js";

export default defineAction({
  description:
    "Accept the clean decision statement proposed for a settled own answer: the interviewer read the answer as holding more than the decision (a note or instruction to the AI, a note to self, a typo). The original text moves to history with the interviewer's reason, and the removed notes are kept there for the owner only, never exported or sent to a model. The statement becomes the answer — the one given in `statement` when the owner edited it — and the decision stays settled, its meaning unchanged, so nothing is reopened or made stale. Another decision's pending supersession naming this one is withdrawn, since it may quote the old text, and the session's spec, if any, is marked not current. Refuses a decision with no restatement pending, and a blank statement.",
  schema: z.object({
    decisionId: z.string().min(1).describe("Decision id"),
    statement: z
      .string()
      .optional()
      .describe(
        "The statement to record instead of the proposed one, when the owner edited it",
      ),
  }),
  run: async ({ decisionId, statement }) => {
    const db = getDb();

    const [row] = await db
      .select()
      .from(schema.decisions)
      .where(eq(schema.decisions.id, decisionId))
      .limit(1);

    if (!row) fail(`Decision not found: ${decisionId}`, { statusCode: 404 });

    if (row.restatementText == null) {
      fail(
        `"${row.questionTitle}" has no restatement to accept: no clean statement has been proposed for its answer.`,
        { errorCode: "no-restatement", statusCode: 409 },
      );
    }

    const edited = statement?.trim();
    if (statement != null && !edited) {
      fail("The statement to record cannot be blank.", {
        errorCode: "empty-statement",
        statusCode: 400,
      });
    }

    const now = new Date().toISOString();
    // Never null: a non-null `operatorNotes` is what marks an accepted
    // restatement's entry, and the interviewer's context leaves every such
    // entry out. Its text is the original answer, which may hold notes even
    // when these are empty (an owner's edit took them out).
    const notes = row.restatementNotes?.trim() ? row.restatementNotes : "";

    await db.insert(schema.decisionHistory).values({
      id: randomUUID(),
      decisionId: row.id,
      questionTitle: row.questionTitle,
      questionBody: row.questionBody,
      answer: row.currentAnswer,
      answerKind: "own-answer",
      interviewerReason: row.restatementReason,
      operatorNotes: notes,
      recordedAt: now,
    });

    // The meaning is unchanged, so the decision stays settled exactly where it
    // was: same kind, same settledAt, same links. Only the text changes.
    const [updated] = await db
      .update(schema.decisions)
      .set({
        currentAnswer: edited || row.restatementText,
        ...CLEARED_RESTATEMENT,
        updatedAt: now,
      })
      .where(eq(schema.decisions.id, decisionId))
      .returning();

    if (!updated) fail("Failed to accept the restatement.", { statusCode: 500 });

    // A pending supersession elsewhere may quote the old text; the next
    // done-time check can propose it again from the clean one. What this
    // decision replaced, and what it settled, stay as they are.
    await withdrawSupersessionsNaming(decisionId, now);

    // The spec was synthesized from the old text.
    await markSpecNotCurrent(row.sessionId, now);

    return describeDecisions([updated])[0];
  },
});
