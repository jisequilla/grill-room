import { defineAction, fail } from "@agent-native/core/action";
import { eq } from "@agent-native/core/db/schema";
import { z } from "zod";

import { currentBriefGrounding } from "../server/brief-grounding.js";
import { getDb, schema } from "../server/db/index.js";

export default defineAction({
  description:
    "Read a session's brief grounding, or null when it has none: the handoff scout's result per ticket (files to change, files it builds on, cited facts, what it needs from each blocker, and what proves it), the commit and handoff fingerprint it was made for, the model, when it ran and its turn record, plus `current` and `staleReason` — `handoff-changed` once the handoff's tickets, spec or project changed since, `head-moved` once the project's HEAD moved, null while current.",
  schema: z.object({
    sessionId: z.string().min(1).describe("Session id"),
  }),
  http: { method: "GET" },
  run: async ({ sessionId }) => {
    const [session] = await getDb()
      .select({ id: schema.sessions.id })
      .from(schema.sessions)
      .where(eq(schema.sessions.id, sessionId))
      .limit(1);

    if (!session) fail(`Session not found: ${sessionId}`, { statusCode: 404 });

    return { sessionId, grounding: await currentBriefGrounding(sessionId) };
  },
});
