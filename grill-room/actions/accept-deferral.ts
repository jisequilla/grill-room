import { defineAction, fail } from "@agent-native/core/action";
import { eq } from "@agent-native/core/db/schema";
import { z } from "zod";

import { defer } from "../server/answer-change.js";
import { getDb, schema } from "../server/db/index.js";
import { describeDecisions } from "../server/tree.js";
import { failIfTurnInProgress } from "../server/turn.js";

export default defineAction({
  description:
    "Accept the deferral proposed on a settled own answer: the interviewer read it as postponing the question rather than deciding it. The own answer moves to history, carrying the interviewer's reason and the kind it had, and the decision becomes a deferred loose end, which blocks confirmation until it is resolved; the claims other decisions make about it are withdrawn and the session's spec, if any, is marked not current; the next round request asks it again as a new card, exactly as if the user had deferred it in a round. Refuses a decision with no deferral pending, and refuses while an interviewer turn is working.",
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

    const [session] = await db
      .select()
      .from(schema.sessions)
      .where(eq(schema.sessions.id, row.sessionId))
      .limit(1);

    failIfTurnInProgress(
      session!,
      "The interviewer is working on this session. Wait for the turn to finish before accepting a deferral.",
    );

    const updated = await defer(row.id, {
      now: new Date().toISOString(),
      reason: row.deferralReason ?? undefined,
    });

    return describeDecisions([updated])[0];
  },
});
