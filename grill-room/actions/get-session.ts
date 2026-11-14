import { defineAction } from "@agent-native/core/action";
import { and, eq } from "@agent-native/core/db/schema";
import { z } from "zod";

import { resolveOwnerId } from "../server/current-owner.js";
import { getDb, schema } from "../server/db/index.js";
import { exportRetirement } from "../server/export-bundle.js";
import { isModelLocked } from "../server/model-lock.js";
import { getTechnicalLevel } from "../server/owner-profiles.js";

export default defineAction({
  description:
    "Read one session by id, so resuming lands exactly where it left off. Also reports `exportRetired` (whether the working folder its last export wrote has been deleted) and `retiredWorkingFolder` (that folder when retired, otherwise null), and `technicalLevel` (the owner's level, or null when unset).",
  schema: z.object({
    id: z.string().min(1).describe("Session id"),
  }),
  http: { method: "GET" },
  run: async ({ id }) => {
    const ownerId = await resolveOwnerId();
    const [row] = await getDb()
      .select()
      .from(schema.sessions)
      .where(
        and(eq(schema.sessions.id, id), eq(schema.sessions.ownerId, ownerId)),
      )
      .limit(1);

    if (!row) throw new Error(`Session not found: ${id}`);

    const retirement = await exportRetirement(id);
    return {
      ...row,
      modelLocked: isModelLocked(row),
      exportRetired: retirement.retired,
      retiredWorkingFolder: retirement.retired ? retirement.workingFolder : null,
      technicalLevel: await getTechnicalLevel(row.ownerId),
    };
  },
});
