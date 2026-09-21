import { defineAction, fail } from "@agent-native/core/action";
import { eq, inArray } from "@agent-native/core/db/schema";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { describeDecisions } from "../server/tree.js";

export default defineAction({
  description:
    "List every round of a session in order, oldest first, with the questions each round asked and the answer given to each, so the history of the interview can be read back.",
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

    const rounds = await db
      .select()
      .from(schema.rounds)
      .where(eq(schema.rounds.sessionId, sessionId))
      .orderBy(schema.rounds.createdAt);

    if (rounds.length === 0) return { sessionId, rounds: [] };

    const placements = await db
      .select()
      .from(schema.roundDecisions)
      .where(
        inArray(
          schema.roundDecisions.roundId,
          rounds.map((round) => round.id),
        ),
      )
      .orderBy(schema.roundDecisions.sortOrder);

    const rows = await db
      .select()
      .from(schema.decisions)
      .where(eq(schema.decisions.sessionId, sessionId));

    const views = new Map(
      describeDecisions(rows).map((view) => [view.id, view]),
    );

    return {
      sessionId,
      rounds: rounds.map((round) => ({
        id: round.id,
        submissionState: round.submissionState,
        createdAt: round.createdAt,
        submittedAt: round.submittedAt,
        decisions: placements
          .filter((placement) => placement.roundId === round.id)
          .flatMap((placement) => {
            const view = views.get(placement.decisionId);
            if (!view) return [];
            return [
              {
                ...view,
                sortOrder: placement.sortOrder,
                /** What was answered in this round, which a later reopen does not rewrite. */
                answeredInRound: placement.draftAnswerKind
                  ? {
                      answer: placement.draftAnswer,
                      answerKind: placement.draftAnswerKind,
                    }
                  : null,
              },
            ];
          }),
      })),
    };
  },
});
