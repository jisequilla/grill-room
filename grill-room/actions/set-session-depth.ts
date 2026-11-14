import { defineAction, fail } from "@agent-native/core/action";
import { and, eq } from "@agent-native/core/db/schema";
import { z } from "zod";

import { resolveOwnerId } from "../server/current-owner.js";
import { getDb, schema } from "../server/db/index.js";
import {
  markSpecNotCurrent,
  returnSessionToInterviewing,
} from "../server/session-state.js";
import { failIfTurnInProgress } from "../server/turn.js";
import { DEPTHS } from "../shared/session-constants.js";
import assessReadiness from "./assess-readiness.js";
import getSession from "./get-session.js";

export default defineAction({
  description:
    "Change how deep a session's grill goes. Before the interview starts (no round, still interviewing): while a turn is working the depth is queued as `pendingDepth` and applied once that turn succeeds; otherwise it takes effect at once, clears the \"Grill it as is\" record and, when the idea has a stored readiness judgment, judges it again at the new depth. After the interview starts: refused with `turn-in-progress` while a turn is working; otherwise the depth takes effect, a done proposal or a confirmation is withdrawn back to interviewing, and the spec, if any, is marked not current. Nothing is regenerated. Returns the session.",
  schema: z.object({
    sessionId: z.string().min(1).describe("Session id"),
    depth: z.enum(DEPTHS).describe("The depth to grill the session to"),
  }),
  run: async ({ sessionId, depth }) => {
    const ownerId = await resolveOwnerId();

    const rejudge = await getDb().transaction(async (tx) => {
      const [session] = await tx
        .select()
        .from(schema.sessions)
        .where(
          and(
            eq(schema.sessions.id, sessionId),
            eq(schema.sessions.ownerId, ownerId),
          ),
        )
        .limit(1);

      if (!session) fail(`Session not found: ${sessionId}`, { statusCode: 404 });

      const [round] = await tx
        .select({ id: schema.rounds.id })
        .from(schema.rounds)
        .where(eq(schema.rounds.sessionId, sessionId))
        .limit(1);
      const started = round !== undefined || session.state !== "interviewing";
      const sameDepth = depth === session.depth;

      if (!started) {
        if (session.turnStatus === "working" || sameDepth) {
          await tx
            .update(schema.sessions)
            .set({ pendingDepth: sameDepth ? null : depth })
            .where(eq(schema.sessions.id, sessionId));
          return false;
        }

        await tx
          .update(schema.sessions)
          .set({
            depth,
            pendingDepth: null,
            readinessOverrideJson: null,
            updatedAt: new Date().toISOString(),
          })
          .where(eq(schema.sessions.id, sessionId));
        return session.readinessJson !== null;
      }

      failIfTurnInProgress(
        session,
        "The interviewer is working on this session. Wait for the turn to finish before changing its depth.",
      );

      if (sameDepth) return false;

      const now = new Date().toISOString();
      await tx
        .update(schema.sessions)
        .set({ depth, pendingDepth: null, updatedAt: now })
        .where(eq(schema.sessions.id, sessionId));
      if (session.state === "interviewing") {
        await markSpecNotCurrent(sessionId, now, tx);
      } else {
        await returnSessionToInterviewing(session, now, tx);
      }
      return false;
    });

    if (rejudge) await assessReadiness.run({ sessionId });

    return getSession.run({ id: sessionId });
  },
});
