import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";

export default defineAction({
  description: "Write one app-wide setting, replacing any existing value.",
  schema: z.object({
    key: z.string().min(1).describe("Setting key, for example defaultModel"),
    value: z.string().describe("Value to store"),
  }),
  run: async ({ key, value }) => {
    const db = getDb();
    await db
      .insert(schema.globalSettings)
      .values({ key, value })
      .onConflictDoUpdate({
        target: schema.globalSettings.key,
        set: { value },
      });

    return { key, value };
  },
});
