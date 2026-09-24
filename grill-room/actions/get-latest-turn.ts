import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { findLatestTurn } from "../server/turn-records.js";

export default defineAction({
  description:
    "Read the most recently started turn record of one kind for a session, with its runs and attempts, or null when the session has none of that kind yet. This is how the live turn status finds a turn that has no round or other result to point at it — a propose-round turn still in flight, say — so the UI and the agent read the same in-progress evidence.",
  schema: z.object({
    sessionId: z.string().min(1).describe("Session id"),
    turnKind: z.string().min(1).describe("Turn kind, e.g. \"propose-round\""),
  }),
  http: { method: "GET" },
  run: async ({ sessionId, turnKind }) => {
    return findLatestTurn({ sessionId, turnKind });
  },
});
