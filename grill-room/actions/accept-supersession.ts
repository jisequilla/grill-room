import { defineAction, fail } from "@agent-native/core/action";
import { eq } from "@agent-native/core/db/schema";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { accept, pendingProposal } from "../server/proposal.js";
import { describeDecisions } from "../server/tree.js";
import { failIfTurnInProgress } from "../server/turn.js";

export default defineAction({
  description:
    "Accept the supersession proposed on a decision. On a loose end, the answer the interviewer found in a later settled decision becomes this decision's own answer, and it settles; the steering move it held moves to history, carrying the interviewer's reason and the kind it had, the decision keeps a lasting link to the one that settled it, its own other pending proposals lapse, the claims other decisions make about it are withdrawn, and the session's spec, if any, is marked not current. On a settled decision a later one replaced, the answer is left as it was and the decision gains a lasting link to its replacement, with the interviewer's reason, and the session's spec, if any, is marked not current. Refuses a decision with no supersession pending, and refuses while an interviewer turn is working.",
  schema: z.object({
    decisionId: z.string().min(1).describe("Decision id"),
  }),
  run: async ({ decisionId }) => {
    const db = getDb();

    const [row] = await db
      .select()
      .from(schema.decisions)
      .where(eq(schema.decisions.id, decisionId))
      .limit(1);

    if (!row) fail(`Decision not found: ${decisionId}`, { statusCode: 404 });

    const kind = pendingProposal(row)?.kind;
    if (kind !== "answered-by" && kind !== "replacement") {
      fail(
        `"${row.questionTitle}" has no supersession to accept: no settled decision has been proposed as already answering it.`,
        { errorCode: "no-supersession", statusCode: 409 },
      );
    }

    const [session] = await db
      .select()
      .from(schema.sessions)
      .where(eq(schema.sessions.id, row.sessionId))
      .limit(1);

    failIfTurnInProgress(
      session!,
      "The interviewer is working on this session. Wait for the turn to finish before accepting a supersession.",
    );

    const updated = await accept(row.id, { now: new Date().toISOString() });

    if (!updated) fail("Failed to accept the supersession.", { statusCode: 500 });

    return describeDecisions([updated])[0];
  },
});
