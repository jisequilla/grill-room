import { defineAction, fail } from "@agent-native/core/action";
import { eq } from "@agent-native/core/db/schema";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { dismiss, pendingProposal } from "../server/proposal.js";
import { describeDecisions } from "../server/tree.js";
import { failIfTurnInProgress } from "../server/turn.js";

export default defineAction({
  description:
    "Reject the supersession proposed on a decision — a loose end a later decision answered, or a settled decision a later one replaced: the proposal is dropped and the decision is left exactly as it was. Records nothing in history — the interviewer's guess was not something the user decided. The dismissal is remembered for as long as the answer stands, so the interviewer does not offer the supersession again. Refuses a decision with no supersession pending, and refuses while an interviewer turn is working.",
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
        `"${row.questionTitle}" has no supersession to dismiss.`,
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
      "The interviewer is working on this session. Wait for the turn to finish before dismissing a supersession.",
    );

    const updated = await dismiss(row.id, { now: new Date().toISOString() });

    if (!updated) {
      fail("Failed to dismiss the supersession.", { statusCode: 500 });
    }

    return describeDecisions([updated])[0];
  },
});
