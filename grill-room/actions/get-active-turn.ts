import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { findLatestCompletedTurn, findRunningTurn } from "../server/turn-records.js";

export default defineAction({
  description:
    "Read the turn record the session's current turn status belongs to, of any kind: the turn still running while the session reads working, or the most recently stopped turn while it reads failed. This is how the live turn status finds whichever kind actually started the turn — a round proposal, a readiness judgment, a stale review, a supersession check, a spec synthesis, or a ticket breakdown — instead of assuming one kind. Null once the session has no turn record at all.",
  schema: z.object({
    sessionId: z.string().min(1).describe("Session id"),
  }),
  http: { method: "GET" },
  run: async ({ sessionId }) => {
    const running = await findRunningTurn(sessionId);
    if (running) return running;
    return findLatestCompletedTurn(sessionId);
  },
});
