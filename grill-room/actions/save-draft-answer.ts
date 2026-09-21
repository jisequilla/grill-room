import { defineAction, fail } from "@agent-native/core/action";
import { and, eq } from "@agent-native/core/db/schema";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { ROUND_ANSWER_KINDS } from "../server/tree.js";

export default defineAction({
  description:
    'Save a draft answer for one card of the open round, so a half-answered round survives a reload. Answer kind is "accepted-recommendation" (defaults the text to the recommendation), "own-answer" (text required), "unknown" (I don\'t know; no text required), "pushed-back" (a reason is required), "deferred" (ask again later; no text required), or "prototype-flagged" (needs a prototype; text is an optional note).',
  schema: z.object({
    decisionId: z.string().min(1).describe("Decision id, the card answered"),
    answerKind: z
      .enum(ROUND_ANSWER_KINDS)
      .describe(
        'How the card was answered: "accepted-recommendation", "own-answer", "unknown", "pushed-back", "deferred", or "prototype-flagged"',
      ),
    answer: z
      .string()
      .optional()
      .describe(
        "The answer text. Required for own-answer and pushed-back (its reason); optional elsewhere; defaults to the recommended answer when the recommendation is accepted.",
      ),
  }),
  run: async ({ decisionId, answerKind, answer }) => {
    const db = getDb();

    const [placement] = await db
      .select({
        roundDecision: schema.roundDecisions,
        decision: schema.decisions,
      })
      .from(schema.roundDecisions)
      .innerJoin(
        schema.rounds,
        eq(schema.rounds.id, schema.roundDecisions.roundId),
      )
      .innerJoin(
        schema.decisions,
        eq(schema.decisions.id, schema.roundDecisions.decisionId),
      )
      .where(
        and(
          eq(schema.roundDecisions.decisionId, decisionId),
          eq(schema.rounds.submissionState, "open"),
        ),
      )
      .limit(1);

    if (!placement) {
      fail(
        `Decision ${decisionId} is not a card of an open round, so it cannot take a draft answer.`,
        { errorCode: "not_in_open_round", statusCode: 404 },
      );
    }

    const text =
      answerKind === "accepted-recommendation"
        ? (answer ?? placement.decision.recommendedAnswer ?? "")
        : (answer ?? "");

    if (answerKind === "own-answer" && text.trim() === "") {
      fail("An own answer needs some text.", {
        errorCode: "empty_answer",
        statusCode: 400,
      });
    }

    if (answerKind === "pushed-back" && text.trim() === "") {
      fail("A push back needs a reason.", {
        errorCode: "empty_reason",
        statusCode: 400,
      });
    }

    const [saved] = await db
      .update(schema.roundDecisions)
      .set({ draftAnswer: text, draftAnswerKind: answerKind })
      .where(eq(schema.roundDecisions.id, placement.roundDecision.id))
      .returning();

    return {
      decisionId,
      roundId: placement.roundDecision.roundId,
      draft: { answer: saved?.draftAnswer ?? text, answerKind },
    };
  },
});
