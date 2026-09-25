import { defineAction, fail } from "@agent-native/core/action";
import { eq } from "@agent-native/core/db/schema";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { describeDecisions } from "../server/tree.js";

export default defineAction({
  description:
    "Reject the supersession proposed on a decision — a loose end a later decision answered, or a settled decision a later one replaced: the proposal is dropped and the decision is left exactly as it was. Records nothing in history — the interviewer's guess was not something the user decided. Refuses a decision with no supersession pending.",
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
        `"${row.questionTitle}" has no supersession to dismiss.`,
        { errorCode: "no-supersession", statusCode: 409 },
      );
    }

    const now = new Date().toISOString();

    const [updated] = await db
      .update(schema.decisions)
      .set({
        supersededById: null,
        supersessionAnswer: null,
        supersessionReason: null,
        updatedAt: now,
      })
      .where(eq(schema.decisions.id, decisionId))
      .returning();

    if (!updated) {
      fail("Failed to dismiss the supersession.", { statusCode: 500 });
    }

    return describeDecisions([updated])[0];
  },
});
