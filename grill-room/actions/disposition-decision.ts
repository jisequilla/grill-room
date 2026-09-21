import { randomUUID } from "node:crypto";

import { defineAction, fail } from "@agent-native/core/action";
import { eq } from "@agent-native/core/db/schema";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { DECISION_DISPOSITION_TARGETS } from "../server/db/schema.js";
import { classifyLooseEnds, describeDecisions, treeFacts } from "../server/tree.js";

export default defineAction({
  description:
    "Resolve a loose end by moving it out of scope or into the notes as a named open question, instead of giving it a real answer. Records the previous state as history and settles the decision as dispositioned, which unblocks its dependents. Never calls the interviewer. Refuses a decision that is not a loose end at all, one that is stale (settled again by the stale review instead), or one that is unplaced (settled by the next proposal instead).",
  schema: z.object({
    decisionId: z.string().min(1).describe("Decision id"),
    target: z
      .enum(DECISION_DISPOSITION_TARGETS)
      .describe("Where the decision is resolved to: out-of-scope or open-question"),
    note: z
      .string()
      .default("")
      .describe("The disposition's note. May be left empty."),
  }),
  run: async ({ decisionId, target, note }) => {
    const db = getDb();

    const [row] = await db
      .select()
      .from(schema.decisions)
      .where(eq(schema.decisions.id, decisionId))
      .limit(1);

    if (!row) fail(`Decision not found: ${decisionId}`, { statusCode: 404 });

    const siblings = await db
      .select()
      .from(schema.decisions)
      .where(eq(schema.decisions.sessionId, row.sessionId))
      .orderBy(schema.decisions.createdAt);

    const reason = classifyLooseEnds(treeFacts(siblings)).get(decisionId);

    if (!reason) {
      fail(
        `"${row.questionTitle}" is not a loose end, so there is nothing to disposition. It already has a real answer, was withdrawn, or was never a loose end to begin with.`,
        { errorCode: "not-a-loose-end", statusCode: 409 },
      );
    }
    if (reason === "stale") {
      fail(
        `"${row.questionTitle}" is stale, not a loose end to disposition: the stale review that runs on the next turn resolves it by reconfirming or re-asking.`,
        { errorCode: "decision-stale", statusCode: 409 },
      );
    }
    if (reason === "unplaced") {
      fail(
        `"${row.questionTitle}" is a user-added decision awaiting the interviewer's placement, not a loose end to disposition: the next proposal resolves it.`,
        { errorCode: "decision-unplaced", statusCode: 409 },
      );
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
        currentAnswer: note,
        answerKind: "dispositioned",
        dispositionTarget: target,
        settledAt: now,
        updatedAt: now,
      })
      .where(eq(schema.decisions.id, decisionId))
      .returning();

    if (!updated) fail("Failed to disposition the decision.", { statusCode: 500 });

    return describeDecisions([updated])[0];
  },
});
