import { defineAction } from "@agent-native/core/action";
import { desc } from "@agent-native/core/db/schema";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";

export default defineAction({
  description:
    "List every session with its title, state, and last activity, most recently active first.",
  schema: z.object({}),
  http: { method: "GET" },
  run: async () => {
    return getDb()
      .select()
      .from(schema.sessions)
      .orderBy(desc(schema.sessions.updatedAt));
  },
});
