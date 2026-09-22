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
      // `updatedAt` has millisecond precision, so two sessions touched inside
      // the same millisecond tie. No other column carries a meaningful
      // secondary "more active" signal, so ties break by id — arbitrary, but
      // deterministic, so the list stops reordering itself on a reload.
      .orderBy(desc(schema.sessions.updatedAt), schema.sessions.id);
  },
});
