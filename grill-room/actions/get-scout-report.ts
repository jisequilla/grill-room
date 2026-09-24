import { defineAction, fail } from "@agent-native/core/action";
import { eq } from "@agent-native/core/db/schema";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { currentScoutReport } from "../server/scout-report.js";

export default defineAction({
  description:
    "Read a session's scout report, or null when it has none: the server facts, the scout's current state and proposed repo decisions, the commit and idea it read, the model, when it ran, its turn record, the keep/drop state of each proposal (undecided, kept or dropped), and `stale` — true once the session's idea or project changed, or the project's HEAD moved, since the report read them.",
  schema: z.object({
    sessionId: z.string().min(1).describe("Session id"),
  }),
  http: { method: "GET" },
  run: async ({ sessionId }) => {
    const [session] = await getDb()
      .select()
      .from(schema.sessions)
      .where(eq(schema.sessions.id, sessionId))
      .limit(1);

    if (!session) fail(`Session not found: ${sessionId}`, { statusCode: 404 });

    return { sessionId, report: await currentScoutReport(session) };
  },
});
