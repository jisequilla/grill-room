import { defineAction } from "@agent-native/core/action";
import { eq } from "@agent-native/core/db/schema";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";

export default defineAction({
  description: "Read a ticket's build record, or null when none has been logged yet.",
  schema: z.object({
    ticketId: z.string().min(1).describe("Ticket id"),
  }),
  http: { method: "GET" },
  run: async ({ ticketId }) => {
    const [record] = await getDb()
      .select()
      .from(schema.buildRecords)
      .where(eq(schema.buildRecords.ticketId, ticketId))
      .limit(1);

    return record ?? null;
  },
});
