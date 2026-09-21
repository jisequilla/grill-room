import { defineAction, fail } from "@agent-native/core/action";
import { eq, inArray } from "@agent-native/core/db/schema";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { describeDecisions } from "../server/tree.js";

export default defineAction({
  description:
    "Read a session's whole design tree: every decision with what it depends on, its answer, its previous answers, and its state (settled, frontier, blocked, or stale) as the app computes it.",
  schema: z.object({
    sessionId: z.string().min(1).describe("Session id"),
  }),
  http: { method: "GET" },
  run: async ({ sessionId }) => {
    const db = getDb();

    const [session] = await db
      .select()
      .from(schema.sessions)
      .where(eq(schema.sessions.id, sessionId))
      .limit(1);

    if (!session) fail(`Session not found: ${sessionId}`, { statusCode: 404 });

    const rows = await db
      .select()
      .from(schema.decisions)
      .where(eq(schema.decisions.sessionId, sessionId))
      .orderBy(schema.decisions.createdAt);

    // What the decision used to say, kept whenever it was reopened, re-asked or
    // reconfirmed. Oldest first, so a decision reads as the story of itself.
    const history = rows.length
      ? await db
          .select()
          .from(schema.decisionHistory)
          .where(
            inArray(
              schema.decisionHistory.decisionId,
              rows.map((row) => row.id),
            ),
          )
          .orderBy(schema.decisionHistory.recordedAt)
      : [];

    return {
      sessionId,
      decisions: describeDecisions(rows).map((decision) => ({
        ...decision,
        previousAnswers: history
          .filter((entry) => entry.decisionId === decision.id)
          .map((entry) => ({
            text: entry.answer,
            kind: entry.answerKind,
            recordedAt: entry.recordedAt,
          })),
      })),
    };
  },
});
