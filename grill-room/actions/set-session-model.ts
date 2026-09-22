import { defineAction, fail } from "@agent-native/core/action";
import { eq } from "@agent-native/core/db/schema";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { SESSION_MODELS } from "../server/db/schema.js";
import { isModelLocked } from "../server/model-lock.js";

export default defineAction({
  description:
    "Change a session's interviewer model before its first round. Refused with a typed 'model-locked' error, carrying the model the session is fixed on, once the interviewer conversation exists or while a turn is working.",
  schema: z.object({
    sessionId: z.string().min(1).describe("Session id"),
    model: z
      .enum(SESSION_MODELS)
      .describe("Interviewer model to switch the session to"),
  }),
  run: async ({ sessionId, model }) => {
    return await getDb().transaction(async (tx) => {
      const [row] = await tx
        .select()
        .from(schema.sessions)
        .where(eq(schema.sessions.id, sessionId));

      if (!row) fail(`Session not found: ${sessionId}`, { statusCode: 404 });

      if (isModelLocked(row)) {
        fail(
          `This session's interviewer model is fixed on ${row.model} and can no longer be changed.`,
          {
            errorCode: "model-locked",
            statusCode: 409,
            details: { recordedModel: row.model },
          },
        );
      }

      const [updated] = await tx
        .update(schema.sessions)
        .set({ model, updatedAt: new Date().toISOString() })
        .where(eq(schema.sessions.id, sessionId))
        .returning();

      return updated;
    });
  },
});
