import { defineAction, fail } from "@agent-native/core/action";
import { eq } from "@agent-native/core/db/schema";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import {
  applyReopenBatch,
  parseBatchProgress,
  type ReopenBatchItem,
} from "../server/reopen-batch.js";
import { failIfTurnInProgress } from "../server/turn.js";

export default defineAction({
  description:
    "Apply a list of reopens whose answers are already decided, in order, and report what happened to each. A settled or stale decision is reopened, answered, and its round submitted — which runs the stale review, so a later item in the list may already be open again by the time the batch reaches it: it is then answered as a card of the open round, or as a loose end, or recorded as not reopenable and skipped. Stops at the first failure and returns what completed. Decisions in `newDecisions` are added once every item has landed. Refused while an interviewer turn is working or another batch is running.",
  schema: z.object({
    sessionId: z.string().min(1).describe("Session id"),
    items: z
      .array(
        z.object({
          decisionId: z
            .string()
            .min(1)
            .optional()
            .describe("Decision id, if known"),
          decisionKey: z
            .string()
            .min(1)
            .optional()
            .describe("The decision's key, as an alternative to its id"),
          answer: z
            .string()
            .min(1)
            .describe("The answer to record, as the user's own answer"),
        }),
      )
      .min(1)
      .describe("The reopens to apply, in order"),
    newDecisions: z
      .array(
        z.object({
          title: z.string().min(1).describe("The question's title"),
          body: z.string().default("").describe("The question's body, if any"),
        }),
      )
      .default([])
      .describe("Decisions to add once every item has been applied"),
  }),
  run: async ({ sessionId, items, newDecisions }) => {
    const db = getDb();

    const [session] = await db
      .select()
      .from(schema.sessions)
      .where(eq(schema.sessions.id, sessionId))
      .limit(1);

    if (!session) fail(`Session not found: ${sessionId}`, { statusCode: 404 });

    failIfTurnInProgress(
      session,
      "The interviewer is working on this session. Wait for the turn to finish before applying a batch.",
    );

    if (parseBatchProgress(session.batchProgressJson)) {
      fail(
        "A batch is already running on this session. Wait for it to finish.",
        { errorCode: "batch-in-progress", statusCode: 409 },
      );
    }

    const rows = await db
      .select({
        id: schema.decisions.id,
        key: schema.decisions.key,
        questionTitle: schema.decisions.questionTitle,
      })
      .from(schema.decisions)
      .where(eq(schema.decisions.sessionId, sessionId));

    const byId = new Set(rows.map((row) => row.id));
    const byKey = new Map(
      rows.flatMap((row) => (row.key ? [[row.key, row.id] as const] : [])),
    );

    // Every item is resolved before the first one is applied: a batch that
    // discovers an unknown decision halfway through has already spent several
    // interviewer turns on a list the user got wrong.
    const resolved: ReopenBatchItem[] = items.map((item) => {
      const id = item.decisionId ?? (item.decisionKey ? byKey.get(item.decisionKey) : undefined);

      if (!id || !byId.has(id)) {
        fail(
          `No decision in this session matches ${item.decisionId ? `id ${item.decisionId}` : `key "${item.decisionKey ?? ""}"`}.`,
          { errorCode: "decision-not-found", statusCode: 404 },
        );
      }

      return { decisionId: id, answer: item.answer };
    });

    return applyReopenBatch({ sessionId, items: resolved, newDecisions });
  },
});
