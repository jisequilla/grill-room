import { defineAction, fail } from "@agent-native/core/action";
import { eq } from "@agent-native/core/db/schema";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { failIfPastFirstRound, sessionHasRounds } from "../server/readiness.js";

export default defineAction({
  description:
    "Replace a session's idea before its first round. The idea is trimmed and must not be empty (idea-required). Clears the stored readiness judgment, which described the old idea. Refused with has-rounds once any round exists and turn-working while a turn is working. Returns the session.",
  schema: z.object({
    sessionId: z.string().min(1).describe("Session id"),
    idea: z.string().describe("The new idea, in the user's words"),
  }),
  run: async ({ sessionId, idea }) => {
    const db = getDb();

    const [session] = await db
      .select()
      .from(schema.sessions)
      .where(eq(schema.sessions.id, sessionId))
      .limit(1);

    if (!session) fail(`Session not found: ${sessionId}`, { statusCode: 404 });

    failIfPastFirstRound(
      session,
      await sessionHasRounds(sessionId),
      "The idea can be edited",
    );

    const trimmed = idea.trim();
    if (!trimmed) {
      fail("The idea cannot be empty.", {
        errorCode: "idea-required",
        statusCode: 400,
      });
    }

    const [row] = await db
      .update(schema.sessions)
      .set({
        idea: trimmed,
        readinessJson: null,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(schema.sessions.id, sessionId))
      .returning();

    return row;
  },
});
