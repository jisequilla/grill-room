import { defineAction, fail } from "@agent-native/core/action";
import { eq } from "@agent-native/core/db/schema";
import { z } from "zod";

import { settle } from "../server/answer-change.js";
import { getDb, schema } from "../server/db/index.js";
import { describeDecisions, LOOSE_END_ANSWER_KINDS } from "../server/tree.js";
import { failIfTurnInProgress } from "../server/turn.js";

export default defineAction({
  description:
    "Give a real answer to an unresolved loose end outside a round: a decision currently unknown, deferred, prototype flagged, or pushed back with no interviewer response yet. Records the previous state as history, settles the decision as an own answer, withdraws the claims other decisions make about it, and marks the session's spec not current. Refused while an interviewer turn is working. Never calls the interviewer; call request-next-round afterwards to let the tree move on.",
  schema: z.object({
    decisionId: z.string().min(1).describe("Decision id"),
    answer: z.string().describe("The real answer"),
  }),
  run: async ({ decisionId, answer }) => {
    const db = getDb();

    const [row] = await db
      .select()
      .from(schema.decisions)
      .where(eq(schema.decisions.id, decisionId))
      .limit(1);

    if (!row) fail(`Decision not found: ${decisionId}`, { statusCode: 404 });

    const isLooseEnd =
      row.withdrawnAt == null &&
      row.answerKind != null &&
      (LOOSE_END_ANSWER_KINDS as readonly string[]).includes(row.answerKind);

    if (!isLooseEnd) {
      fail(
        `Decision ${decisionId} is not an unresolved loose end (unknown, deferred, prototype flagged, or pushed back awaiting a response), so it cannot be answered this way.`,
        { errorCode: "not_a_loose_end", statusCode: 409 },
      );
    }

    if (answer.trim() === "") {
      fail("An answer needs some text.", {
        errorCode: "empty_answer",
        statusCode: 400,
      });
    }

    const [session] = await db
      .select()
      .from(schema.sessions)
      .where(eq(schema.sessions.id, row.sessionId))
      .limit(1);

    failIfTurnInProgress(
      session!,
      "The interviewer is working on this session. Wait for the turn to finish before answering a decision.",
    );

    const updated = await settle(
      row.id,
      { answer, kind: "own-answer" },
      { now: new Date().toISOString() },
    );

    return describeDecisions([updated])[0];
  },
});
