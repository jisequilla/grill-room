import { defineAction, fail } from "@agent-native/core/action";
import { eq } from "@agent-native/core/db/schema";
import { z } from "zod";

import { moveSetAside } from "../server/answer-change.js";
import { getDb, schema } from "../server/db/index.js";
import { DECISION_DISPOSITION_TARGETS } from "../server/db/schema.js";
import { deriveTreeStates, describeDecisions, treeFacts } from "../server/tree.js";
import { failIfTurnInProgress } from "../server/turn.js";

export default defineAction({
  description:
    "Move a settled, set-aside decision to another target: out of scope, an open question, or the builder's call. Changes only the target: the note, the history, the links and the claims stay, and no dependent goes stale, since the answer did not change. Marks the session's spec not current, because the spec places the three kinds in different sections. Never calls the interviewer. Refused, writing nothing, with not-found, decision-unplaced, decision-stale, not-set-aside (anything but a settled set-aside decision), same-target (a move to the target it already has) or turn-in-progress.",
  schema: z.object({
    decisionId: z.string().min(1).describe("Decision id"),
    target: z
      .enum(DECISION_DISPOSITION_TARGETS)
      .describe("The target to move to: out-of-scope, open-question or builders-call"),
  }),
  run: async ({ decisionId, target }) => {
    const db = getDb();

    const [row] = await db
      .select()
      .from(schema.decisions)
      .where(eq(schema.decisions.id, decisionId))
      .limit(1);

    if (!row) {
      fail(`Decision not found: ${decisionId}`, {
        errorCode: "not-found",
        statusCode: 404,
      });
    }

    const siblings = await db
      .select()
      .from(schema.decisions)
      .where(eq(schema.decisions.sessionId, row.sessionId))
      // `createdAt` has millisecond precision; id as a final tie-break keeps
      // this deterministic when two decisions land in the same millisecond.
      .orderBy(schema.decisions.createdAt, schema.decisions.id);

    const state = deriveTreeStates(treeFacts(siblings)).get(decisionId);

    if (state === "unplaced") {
      fail(
        `"${row.questionTitle}" is a user-added decision awaiting the interviewer's placement, so it cannot be moved yet.`,
        { errorCode: "decision-unplaced", statusCode: 409 },
      );
    }
    if (state === "stale") {
      fail(
        `"${row.questionTitle}" is stale: the stale review that runs on the next turn resolves it before it can be moved.`,
        { errorCode: "decision-stale", statusCode: 409 },
      );
    }
    if (state !== "settled" || row.answerKind !== "dispositioned") {
      fail(
        `"${row.questionTitle}" is not a settled set-aside decision, so there is no target to move.`,
        { errorCode: "not-set-aside", statusCode: 409 },
      );
    }
    if (row.dispositionTarget === target) {
      fail(`"${row.questionTitle}" is already set aside as ${target}.`, {
        errorCode: "same-target",
        statusCode: 409,
      });
    }

    const [session] = await db
      .select()
      .from(schema.sessions)
      .where(eq(schema.sessions.id, row.sessionId))
      .limit(1);

    failIfTurnInProgress(
      session!,
      "The interviewer is working on this session. Wait for the turn to finish before moving a decision.",
    );

    const updated = await moveSetAside(row.id, target, {
      now: new Date().toISOString(),
    });

    return describeDecisions([updated])[0];
  },
});
