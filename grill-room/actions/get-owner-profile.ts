import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { resolveOwnerId } from "../server/current-owner.js";
import { getTechnicalLevel } from "../server/owner-profiles.js";

export default defineAction({
  description:
    "Read the current owner's profile: their id and their technical level, or null when they have not set one.",
  schema: z.object({}),
  http: { method: "GET" },
  run: async () => {
    const ownerId = await resolveOwnerId();
    return { ownerId, technicalLevel: await getTechnicalLevel(ownerId) };
  },
});
