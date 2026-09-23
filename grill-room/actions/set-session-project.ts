import { defineAction, fail } from "@agent-native/core/action";
import { eq } from "@agent-native/core/db/schema";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { getProject } from "../server/projects.js";

export default defineAction({
  description:
    "Set the registered project a session exports into, or clear it with null.",
  schema: z.object({
    sessionId: z.string().min(1).describe("Session id"),
    projectId: z
      .string()
      .min(1)
      .nullable()
      .describe("Id of a registered project; null clears the session's project"),
  }),
  run: async ({ sessionId, projectId }) => {
    const db = getDb();

    const [session] = await db
      .select()
      .from(schema.sessions)
      .where(eq(schema.sessions.id, sessionId))
      .limit(1);
    if (!session) fail(`Session not found: ${sessionId}`, { statusCode: 404 });

    if (projectId !== null && !(await getProject(projectId))) {
      fail(`Project not found: ${projectId}`, {
        errorCode: "project-not-found",
        statusCode: 404,
      });
    }

    const [row] = await db
      .update(schema.sessions)
      .set({ projectId, updatedAt: new Date().toISOString() })
      .where(eq(schema.sessions.id, sessionId))
      .returning();

    return row;
  },
});
