import { defineAction, fail } from "@agent-native/core/action";
import { eq } from "@agent-native/core/db/schema";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import {
  describeHandoff,
  getHandoffRow,
  handoffFingerprint,
  loadHandoffSource,
} from "../server/handoff.js";

export default defineAction({
  description:
    "Read a session's handoff: HANDOFF.md and one brief per ticket (bundle paths written as {{BUNDLE}}, filled in at export), or null when none has been generated. Carries `stale` (the session, spec, tickets or project changed since it was generated, per a fingerprint over everything it renders), `exportStale` (edited or regenerated after the last export that included it), and `canGenerate` with the reason generation is refused when it is not possible.",
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

    const loaded = await loadHandoffSource(sessionId);
    const currentFingerprint = "source" in loaded ? handoffFingerprint(loaded.source) : null;
    const row = await getHandoffRow(sessionId);

    return {
      handoff: row ? describeHandoff(row, currentFingerprint) : null,
      canGenerate: "source" in loaded,
      cannotGenerateReason: "refusal" in loaded ? loaded.refusal : null,
    };
  },
});
