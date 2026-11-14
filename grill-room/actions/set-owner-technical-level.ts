import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { resolveOwnerId } from "../server/current-owner.js";
import { setTechnicalLevel } from "../server/owner-profiles.js";
import { TECHNICAL_LEVELS } from "../shared/session-constants.js";

export default defineAction({
  description:
    "Change how technical the current owner is. The level belongs to the owner, not to a session: every session of theirs reads it on its next turn. A level is changed, never cleared.",
  schema: z.object({
    technicalLevel: z
      .enum(TECHNICAL_LEVELS)
      .describe("The owner's technical level"),
  }),
  run: async ({ technicalLevel }) => {
    const ownerId = await resolveOwnerId();
    await setTechnicalLevel(ownerId, technicalLevel);
    return { ownerId, technicalLevel };
  },
});
