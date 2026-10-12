import { defineAction, fail } from "@agent-native/core/action";
import { eq } from "@agent-native/core/db/schema";
import { z } from "zod";

import { reword } from "../server/answer-change.js";
import { getDb, schema } from "../server/db/index.js";
import { describeDecisions } from "../server/tree.js";
import { failIfTurnInProgress } from "../server/turn.js";

export default defineAction({
  description:
    "Accept the clean decision statement proposed for a settled own answer: the interviewer read the answer as holding more than the decision (a note or instruction to the AI, a note to self, a typo). The original text moves to history with the interviewer's reason and the kind it had, and the removed notes are kept there for the owner only, never exported or sent to a model. The statement becomes the answer — the one given in `statement` when the owner edited it — and the decision stays settled, its meaning unchanged, so nothing is reopened or made stale. The decision's own other pending proposals lapse. Another decision's pending supersession naming this one is withdrawn, since it may quote the old text, and the session's spec, if any, is marked not current. Refuses a decision with no restatement pending, a blank statement, and while an interviewer turn is working.",
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

    const [session] = await db
      .select()
      .from(schema.sessions)
      .where(eq(schema.sessions.id, row.sessionId))
      .limit(1);

    failIfTurnInProgress(
      session!,
      "The interviewer is working on this session. Wait for the turn to finish before accepting a restatement.",
    );

    // Never null: a non-null `operatorNotes` is what marks an accepted
    // restatement's entry, and the interviewer's context leaves every such
    // entry out. Its text is the original answer, which may hold notes even
    // when these are empty (an owner's edit took them out).
    const notes = row.restatementNotes?.trim() ? row.restatementNotes : "";

    const updated = await reword(
      row.id,
      { text: edited || row.restatementText, notes },
      {
        now: new Date().toISOString(),
        reason: row.restatementReason ?? undefined,
      },
    );

    return describeDecisions([updated])[0];
  },
});
