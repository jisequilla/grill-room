import { defineAction } from "@agent-native/core/action";
import { eq } from "@agent-native/core/db/schema";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { exportRetirement } from "../server/export-bundle.js";
import { isModelLocked } from "../server/model-lock.js";

export default defineAction({
  description:
    "Read one session by id, so resuming lands exactly where it left off. Also reports `exportRetired` (whether the working folder its last export wrote has been deleted) and `retiredWorkingFolder` (that folder when retired, otherwise null).",
  schema: z.object({
    id: z.string().min(1).describe("Session id"),
  }),
  http: { method: "GET" },
  run: async ({ id }) => {
    const [row] = await getDb()
      .select()
      .from(schema.sessions)
      .where(eq(schema.sessions.id, id))
      .limit(1);

    if (!row) throw new Error(`Session not found: ${id}`);

    const retirement = await exportRetirement(id);
    return {
      ...row,
      modelLocked: isModelLocked(row),
      exportRetired: retirement.retired,
      retiredWorkingFolder: retirement.retired ? retirement.workingFolder : null,
    };
  },
});
