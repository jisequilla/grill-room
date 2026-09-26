import { defineAction, fail } from "@agent-native/core/action";
import { eq } from "@agent-native/core/db/schema";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { describeDecisions } from "../server/tree.js";

export default defineAction({
  description:
    "Reject the deferral proposed on a settled own answer: the proposal is dropped and the decision stays settled with its answer exactly as it was. Records nothing in history — the interviewer's reading was not something the user decided. Refuses a decision with no deferral pending.",
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
      fail(`"${row.questionTitle}" has no deferral to dismiss.`, {
        errorCode: "no-deferral",
        statusCode: 409,
      });
    }

    const [updated] = await db
      .update(schema.decisions)
      .set({ deferralReason: null, updatedAt: new Date().toISOString() })
      .where(eq(schema.decisions.id, decisionId))
      .returning();

    if (!updated) fail("Failed to dismiss the deferral.", { statusCode: 500 });

    return describeDecisions([updated])[0];
  },
});
