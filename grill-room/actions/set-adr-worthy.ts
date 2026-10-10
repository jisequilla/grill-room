import { defineAction, fail } from "@agent-native/core/action";
import { eq } from "@agent-native/core/db/schema";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { citability } from "../server/tickets.js";
import { describeDecisions } from "../server/tree.js";

export default defineAction({
  description:
    "Flag a settled decision as ADR-worthy, or unflag it, and edit its Consequences. ADR-worthy means an architecturally significant decision that is costly to reverse, which the export suggests as an ADR. Consequences are required to flag: a flagged decision always has non-blank Consequences. Unflagging keeps the stored Consequences; a blank edit while unflagged clears them. Never calls the interviewer and changes nothing else. Refuses a decision that is not settled (or was dispositioned), one a later decision replaced, and a flag without Consequences.",
  schema: z.object({
    decisionId: z.string().min(1).describe("Decision id"),
    adrWorthy: z
      .boolean()
      .describe(
        "Whether the decision is ADR-worthy: architecturally significant and costly to reverse, so the export suggests it as an ADR. Flagging requires Consequences.",
      ),
    consequences: z
      .string()
      .optional()
      .describe(
        "The decision's Consequences, trimmed on save. Required to flag unless some are already stored. Omit to keep the stored ones; a blank string clears them when unflagging.",
      ),
  }),
  run: async ({ decisionId, adrWorthy, consequences }) => {
    const db = getDb();

    const [row] = await db
      .select()
      .from(schema.decisions)
      .where(eq(schema.decisions.id, decisionId))
      .limit(1);

    if (!row) fail(`Decision not found: ${decisionId}`, { statusCode: 404 });

    const siblings = await db
      .select()
      .from(schema.decisions)
      .where(eq(schema.decisions.sessionId, row.sessionId))
      .orderBy(schema.decisions.createdAt, schema.decisions.id);

    const view = describeDecisions(siblings).find((d) => d.id === decisionId);
    const citable = view ? citability(view) : "not-settled";
    if (citable === "not-settled") {
      fail(
        `"${row.questionTitle}" is not settled with a real answer, so it cannot be flagged ADR-worthy.`,
        { errorCode: "decision-not-settled", statusCode: 409 },
      );
    }
    if (citable === "replaced") {
      fail(
        `"${row.questionTitle}" was replaced by a later decision, so it cannot be flagged ADR-worthy.`,
        { errorCode: "decision-replaced", statusCode: 409 },
      );
    }

    const stored =
      consequences === undefined ? row.consequences : consequences.trim() || null;
    if (adrWorthy && !stored?.trim()) {
      fail(`Flagging "${row.questionTitle}" as ADR-worthy requires Consequences.`, {
        errorCode: "consequences-required",
        statusCode: 400,
      });
    }

    const [updated] = await db
      .update(schema.decisions)
      .set({
        adrWorthy,
        consequences: stored,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(schema.decisions.id, decisionId))
      .returning();

    if (!updated) fail("Failed to update the decision.", { statusCode: 500 });

    return describeDecisions([updated])[0];
  },
});
