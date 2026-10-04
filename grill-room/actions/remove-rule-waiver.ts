import { defineAction, fail } from "@agent-native/core/action";
import { and, eq } from "@agent-native/core/db/schema";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { loadRuleConflictLists } from "../server/export-bundle.js";

export default defineAction({
  description:
    "Remove an owner's acceptance of a rule conflict, so the conflict reads as open again in HANDOFF, the brief and `preview-export`. The waiver must belong to the session; a lapsed one (no conflict matches it now) may be removed too. Refuses with 404 for an unknown session, and `waiver-not-found` (404) for a waiver id the session does not hold; nothing is written. Needs no handoff: with none, or with a handoff source that cannot load, the waiver is still removed and both lists come back empty. A waiver never changes the handoff's fingerprint. Returns `{ ruleConflicts, acceptedRuleConflicts }` in the shape `preview-export` reports.",
  schema: z.object({
    sessionId: z.string().min(1).describe("Session id"),
    waiverId: z.string().min(1).describe("The `waiverId` of an accepted conflict from `preview-export`"),
  }),
  run: async ({ sessionId, waiverId }) => {
    const db = getDb();
    const [session] = await db
      .select()
      .from(schema.sessions)
      .where(eq(schema.sessions.id, sessionId))
      .limit(1);
    if (!session) fail(`Session not found: ${sessionId}`, { statusCode: 404 });

    const owned = and(eq(schema.ruleWaivers.id, waiverId), eq(schema.ruleWaivers.sessionId, sessionId));
    const [waiver] = await db.select().from(schema.ruleWaivers).where(owned).limit(1);
    if (!waiver) {
      fail(`Rule waiver not found: ${waiverId}`, { errorCode: "waiver-not-found", statusCode: 404 });
    }

    await db.delete(schema.ruleWaivers).where(owned);

    return loadRuleConflictLists(sessionId);
  },
});
