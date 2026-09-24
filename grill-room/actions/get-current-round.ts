import { defineAction, fail } from "@agent-native/core/action";
import { and, desc, eq } from "@agent-native/core/db/schema";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import {
  canEditIdea,
  currentReadiness,
  sessionHasRounds,
} from "../server/readiness.js";
import { describeDecisions } from "../server/tree.js";

export default defineAction({
  description:
    "Read the round a session is currently answering, with each card's question, recommended answer, derived state, saved draft, and the id of the turn that proposed the round (null for a round from before turn records existed). Also reports the session's state, its done-proposal summary when it has one, whether the interviewer is working, idle, or failed, the idea's readiness judgment (null when none, or when it judged an earlier idea), and whether the idea can still be edited (no round yet, no turn working).",
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

    const turn = {
      sessionId,
      state: session.state,
      doneSummary: session.doneSummary,
      turnStatus: session.turnStatus,
      turnStartedAt: session.turnStartedAt,
      turnError: session.turnErrorCode
        ? {
            code: session.turnErrorCode,
            message: session.turnErrorMessage ?? "",
          }
        : null,
      readiness: await currentReadiness(session),
      canEditIdea: canEditIdea(session, await sessionHasRounds(sessionId)),
    };

    const [round] = await db
      .select()
      .from(schema.rounds)
      .where(
        and(
          eq(schema.rounds.sessionId, sessionId),
          eq(schema.rounds.submissionState, "open"),
        ),
      )
      // Only one round is ever "open" at a time, so this tie-break is
      // defensive rather than load-bearing: total order still costs nothing.
      .orderBy(desc(schema.rounds.createdAt), schema.rounds.id)
      .limit(1);

    if (!round) return { ...turn, round: null };

    const placements = await db
      .select()
      .from(schema.roundDecisions)
      .where(eq(schema.roundDecisions.roundId, round.id))
      .orderBy(schema.roundDecisions.sortOrder);

    // The whole tree, not just this round's cards: a card's state depends on
    // decisions the round does not contain, and a dependency missing from the
    // set being derived would read as blocked.
    const rows = await db
      .select()
      .from(schema.decisions)
      .where(eq(schema.decisions.sessionId, sessionId));

    const views = new Map(
      describeDecisions(rows).map((view) => [view.id, view]),
    );

    return {
      ...turn,
      round: {
        id: round.id,
        submissionState: round.submissionState,
        /** The turn that proposed this round, or null for a round from before turn records existed. Feeds the collapsed attempt log shown on the round. */
        turnId: round.turnId,
        createdAt: round.createdAt,
        submittedAt: round.submittedAt,
        decisions: placements.flatMap((placement) => {
          const view = views.get(placement.decisionId);
          if (!view) return [];
          return [
            {
              ...view,
              sortOrder: placement.sortOrder,
              draft: placement.draftAnswerKind
                ? {
                    answer: placement.draftAnswer,
                    answerKind: placement.draftAnswerKind,
                  }
                : null,
            },
          ];
        }),
      },
    };
  },
});
