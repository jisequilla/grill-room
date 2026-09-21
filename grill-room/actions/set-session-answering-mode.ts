import { defineAction } from "@agent-native/core/action";
import { eq } from "@agent-native/core/db/schema";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { SESSION_ANSWERING_MODES } from "../server/db/schema.js";

export default defineAction({
  description:
    "Switch a session between whole-round and one-at-a-time answering, so the user is never locked into their first choice.",
  schema: z.object({
    id: z.string().min(1).describe("Session id"),
    answeringMode: z.enum(SESSION_ANSWERING_MODES),
  }),
  run: async ({ id, answeringMode }) => {
    const [row] = await getDb()
      .update(schema.sessions)
      .set({ answeringMode, updatedAt: new Date().toISOString() })
      .where(eq(schema.sessions.id, id))
      .returning();

    if (!row) throw new Error(`Session not found: ${id}`);

    return row;
  },
});
