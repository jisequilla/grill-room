import { defineAction, fail } from "@agent-native/core/action";
import { eq } from "@agent-native/core/db/schema";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { accept, pendingProposal } from "../server/proposal.js";
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

    if (pendingProposal(row)?.kind !== "restatement") {
      fail(
        `"${row.questionTitle}" has no restatement to accept: no clean statement has been proposed for its answer.`,
        { errorCode: "no-restatement", statusCode: 409 },
      );
    }

    if (statement != null && !statement.trim()) {
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

    const updated = await accept(row.id, {
      now: new Date().toISOString(),
      statement,
    });

    if (!updated) fail("Failed to accept the restatement.", { statusCode: 500 });

    return describeDecisions([updated])[0];
  },
});
