import { randomUUID } from "node:crypto";

import { defineAction, fail } from "@agent-native/core/action";
import { eq } from "@agent-native/core/db/schema";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import {
  CLEARED_ANSWER_LINKS,
  CLEARED_PROPOSAL,
  describeDecisions,
  LOOSE_END_ANSWER_KINDS,
} from "../server/tree.js";

export default defineAction({
  description:
    "Give a real answer to an unresolved loose end outside a round: a decision currently unknown, deferred, prototype flagged, or pushed back with no interviewer response yet. Records the previous state as history and settles the decision as an own answer. Never calls the interviewer; call request-next-round afterwards to let the tree move on.",
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

    const now = new Date().toISOString();

    await db.insert(schema.decisionHistory).values({
      id: randomUUID(),
      decisionId: row.id,
      questionTitle: row.questionTitle,
      questionBody: row.questionBody,
      answer: row.currentAnswer,
      answerKind: row.answerKind,
      recordedAt: now,
    });

    const [updated] = await db
      .update(schema.decisions)
      .set({
        currentAnswer: answer,
        answerKind: "own-answer",
        settledAt: now,
        // The user answered it themselves, so whatever the interviewer thought
        // had already answered it is moot.
        ...CLEARED_PROPOSAL,
        ...CLEARED_ANSWER_LINKS,
        updatedAt: now,
      })
      .where(eq(schema.decisions.id, decisionId))
      .returning();

    if (!updated) fail("Failed to answer the decision.", { statusCode: 500 });

    return describeDecisions([updated])[0];
  },
});
