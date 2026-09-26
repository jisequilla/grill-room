import { defineAction, fail } from "@agent-native/core/action";
import { eq } from "@agent-native/core/db/schema";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { CLEARED_RESTATEMENT, describeDecisions } from "../server/tree.js";

export default defineAction({
  description:
    "Reject the clean statement proposed for a settled own answer: the proposal is dropped and the answer stays exactly as the owner wrote it. Records nothing in history. Refuses a decision with no restatement pending.",
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

    if (row.restatementText == null) {
      fail(`"${row.questionTitle}" has no restatement to dismiss.`, {
        errorCode: "no-restatement",
        statusCode: 409,
      });
    }

    const [updated] = await db
      .update(schema.decisions)
      .set({ ...CLEARED_RESTATEMENT, updatedAt: new Date().toISOString() })
      .where(eq(schema.decisions.id, decisionId))
      .returning();

    if (!updated) fail("Failed to dismiss the restatement.", { statusCode: 500 });

    return describeDecisions([updated])[0];
  },
});
