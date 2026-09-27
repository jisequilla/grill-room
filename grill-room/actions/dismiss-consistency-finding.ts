import { defineAction, fail } from "@agent-native/core/action";
import { eq } from "@agent-native/core/db/schema";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import listConsistencyFindings from "./list-consistency-findings.js";

export default defineAction({
  description:
    "Dismiss one open reopen card: the owner decided the finding needs no answer. It stays dismissed when a later consistency check reports the same finding again (same kind and quotes). Refused with finding-not-found and not-open. Returns the session's cards, as list-consistency-findings does.",
  schema: z.object({
    findingId: z.string().min(1).describe("Reopen card id"),
  }),
  run: async ({ findingId }) => {
    const db = getDb();

    const [row] = await db
      .select()
      .from(schema.consistencyFindings)
      .where(eq(schema.consistencyFindings.id, findingId))
      .limit(1);

    if (!row) {
      fail(`Reopen card not found: ${findingId}`, {
        errorCode: "finding-not-found",
        statusCode: 404,
      });
    }

    if (row.status !== "open") {
      fail(`Finding ${row.number} is already ${row.status}.`, {
        errorCode: "not-open",
        statusCode: 409,
      });
    }

    await db
      .update(schema.consistencyFindings)
      .set({ status: "dismissed", updatedAt: new Date().toISOString() })
      .where(eq(schema.consistencyFindings.id, findingId));

    return listConsistencyFindings.run({ sessionId: row.sessionId });
  },
});
