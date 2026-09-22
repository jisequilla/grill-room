import { defineAction, fail } from "@agent-native/core/action";
import { eq } from "@agent-native/core/db/schema";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { runSupersessionTurn } from "../server/supersession.js";
import { failIfTurnInProgress } from "../server/turn.js";
import listLooseEnds from "./list-loose-ends.js";

export default defineAction({
  description:
    "Ask the interviewer which of a session's open loose ends — unknown, deferred, prototype flagged, or pushed back — have already been answered by a decision that settled later under a different question. What comes back is stored as a proposal on each loose end, which stays a loose end until the user accepts it. Runs on its own turn, so it can be repeated after more questions have been answered. Allowed while interviewing or with a done proposal pending, and refused while a turn is working.",
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

    failIfTurnInProgress(
      session,
      "The interviewer is working on this session. Wait for the turn to finish before checking for answered loose ends.",
    );

    if (session.state !== "done-proposed" && session.state !== "interviewing") {
      fail(
        `Only a session still being interviewed, or one with a done proposal pending, can be checked for answered loose ends. This session is ${session.state}.`,
        { errorCode: "wrong-session-state", statusCode: 409 },
      );
    }

    await runSupersessionTurn(sessionId);

    // The loose ends themselves, proposals and all: the caller asked what is
    // still open, and the answer to that is the list it already reads.
    return listLooseEnds.run({ sessionId });
  },
});
