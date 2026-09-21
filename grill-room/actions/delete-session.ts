import { defineAction } from "@agent-native/core/action";
import { eq } from "@agent-native/core/db/schema";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";

export default defineAction({
  description:
    "Delete a session and everything under it: its decisions, decision history, rounds, spec, tickets, and build records.",
  schema: z.object({
    id: z.string().min(1).describe("Session id"),
  }),
  run: async ({ id }) => {
    const [row] = await getDb()
      .delete(schema.sessions)
      .where(eq(schema.sessions.id, id))
      .returning();

    if (!row) throw new Error(`Session not found: ${id}`);

    return { id };
  },
});
