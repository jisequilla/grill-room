import { defineAction } from "@agent-native/core/action";
import { eq } from "@agent-native/core/db/schema";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";

export default defineAction({
  description: "Read one app-wide setting. Returns null when it is unset.",
  schema: z.object({
    key: z.string().min(1).describe("Setting key, for example defaultModel"),
  }),
  http: { method: "GET" },
  run: async ({ key }) => {
    const db = getDb();
    const [row] = await db
      .select()
      .from(schema.globalSettings)
      .where(eq(schema.globalSettings.key, key))
      .limit(1);

    return { key, value: row?.value ?? null };
  },
});
