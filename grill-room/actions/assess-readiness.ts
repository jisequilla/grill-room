import { defineAction, fail } from "@agent-native/core/action";
import { eq } from "@agent-native/core/db/schema";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { getInterviewer } from "../server/interviewer/index.js";
import type { AssessReadinessResult } from "../server/interviewer/index.js";
import {
  currentReadiness,
  failIfPastFirstRound,
  reasonsToRefuseReadiness,
  sessionHasRounds,
  storeReadiness,
} from "../server/readiness.js";
import {
  askUntilAccepted,
  MAX_TURN_RETRIES,
  runTurn,
  TurnRejected,
} from "../server/turn.js";

export default defineAction({
  description:
    "Ask the interviewer whether a session's idea is ready to be grilled: the evidence it states in its own words, the single buildable objective (or none), whether that objective is a process, the expected outcome, the unknowns it raises, a ready or not-ready verdict, and what is missing. Stores the judgment on the session with the idea it judged and returns it. Only before the first round: refused with has-rounds once any round exists, turn-working while a turn is working, and wrong-session-state outside interviewing. It never blocks starting the interview.",
  schema: z.object({
    sessionId: z.string().min(1).describe("Session id"),
  }),
  run: async ({ sessionId }) => {
    const db = getDb();

    const [session] = await db
      .select()
      .from(schema.sessions)
      .where(eq(schema.sessions.id, sessionId))
      .limit(1);

    if (!session) fail(`Session not found: ${sessionId}`, { statusCode: 404 });

    failIfPastFirstRound(
      session,
      await sessionHasRounds(sessionId),
      "An idea can be judged for readiness",
    );

    if (session.state !== "interviewing") {
      fail(
        `Only a session still being interviewed can have its idea judged. This session is ${session.state}.`,
        { errorCode: "wrong-session-state", statusCode: 409 },
      );
    }

    // The judgment is not part of the interview: it runs in a conversation of
    // its own and leaves the session's untouched, so the first round starts
    // fresh and the model stays unlocked, whatever idea is judged.
    await runTurn({
      sessionId,
      failedMessage: "The readiness turn failed.",
      take: async () => {
        const accepted = await askUntilAccepted<AssessReadinessResult>({
          conversationId: null,
          ask: ({ rejectionReason }) =>
            getInterviewer().assessReadiness({
              kind: "assess-readiness",
              context: {
                idea: session.idea,
                title: session.title,
                model: session.model,
                answeringMode: session.answeringMode,
                docsFolder: session.docsFolder,
                conversationId: null,
                decisions: [],
              },
              rejectionReason,
            }),
          reasonsToRefuse: (result) =>
            reasonsToRefuseReadiness(result, session.idea),
          exhausted: (lastReason) =>
            new TurnRejected(
              "invalid-readiness",
              `The interviewer returned a readiness verdict that contradicts its own findings ${MAX_TURN_RETRIES + 1} times. Last reason: ${lastReason}`,
            ),
        });

        const now = new Date().toISOString();
        await db
          .update(schema.sessions)
          .set({
            readinessJson: storeReadiness(session.idea, accepted.result, now),
            updatedAt: now,
          })
          .where(eq(schema.sessions.id, sessionId));

        return session.conversationId;
      },
    });

    const [judged] = await db
      .select()
      .from(schema.sessions)
      .where(eq(schema.sessions.id, sessionId))
      .limit(1);

    return { sessionId, readiness: judged ? currentReadiness(judged) : null };
  },
});
