import { defineAction, fail } from "@agent-native/core/action";
import { eq } from "@agent-native/core/db/schema";
import { z } from "zod";

import { listConsistencyFindings } from "../server/consistency.js";
import { getDb, schema } from "../server/db/index.js";

export default defineAction({
  description:
    "A session's reopen cards from its last accepted consistency check, in number order: each finding's kind, where its words are (`at`, and `against` for a spec-ticket contradiction), the question for the owner, the settled decision it came from, whether it is open, dismissed or asked in the interview, and for an asked card the decision it became (`decision`: id, key, derived state, and its answer while settled; null once that decision is gone). `checked` is whether any check has been accepted; `current` is whether that check judged today's tickets (a re-synthesized spec, a reopened decision, an asked card, or a breakdown whose check failed makes it false); `askable` is whether its cards can still be asked with ask-consistency-findings (the check judged this breakdown and this exact spec text). `note` is the code and message the last breakdown left when its check failed or was skipped, while no later turn has cleared it; null otherwise. `turnId` is the check's turn record. A session with no spec has no cards and reads unchecked.",
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

    return listConsistencyFindings(sessionId);
  },
});
