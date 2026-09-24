import { randomUUID } from "node:crypto";

import { defineAction, fail } from "@agent-native/core/action";
import { eq } from "@agent-native/core/db/schema";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { getInterviewer } from "../server/interviewer/index.js";
import type { SynthesizeSpecResult } from "../server/interviewer/index.js";
import type { DecisionRow } from "../server/tree.js";
import {
  askUntilAccepted,
  decisionSnapshots,
  failIfTurnInProgress,
  MAX_TURN_RETRIES,
  runTurn,
  TurnRejected,
} from "../server/turn.js";

/**
 * The template's seven sections, each expected as its own level-2 heading
 * line. The only app-side check of the synthesized markdown: everything else
 * about following the template is the interviewer's to get right.
 */
const REQUIRED_SPEC_HEADINGS = [
  "## Problem Statement",
  "## Solution",
  "## User Stories",
  "## Implementation Decisions",
  "## Testing Decisions",
  "## Out of Scope",
  "## Further Notes",
] as const;

function missingSpecHeadings(markdown: string): string[] {
  const present = new Set(
    markdown
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.startsWith("## ")),
  );
  return REQUIRED_SPEC_HEADINGS.filter((heading) => !present.has(heading));
}

/** One dispositioned decision, as it belongs in the spec: title, then body, then the user's note. */
function formatDisposition(row: DecisionRow): string {
  return [row.questionTitle, row.questionBody, row.currentAnswer]
    .map((part) => part?.trim())
    .filter((part): part is string => Boolean(part))
    .join(" — ");
}

export default defineAction({
  description:
    "Synthesize the session's spec from its settled decisions, following the upstream to-spec template's sections and rules verbatim. Allowed only for a confirmed session with no turn already working. Decisions dispositioned out of scope feed the spec's Out of Scope section; decisions dispositioned as open questions feed Further Notes. Regenerating replaces the previous markdown and marks any already-generated tickets out of date.",
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
      "The interviewer is working on this session. Wait for the turn to finish before synthesizing the spec.",
    );

    if (session.state !== "confirmed") {
      fail(
        `Only a confirmed session can synthesize a spec. This session is ${session.state}.`,
        { errorCode: "not-confirmed", statusCode: 409 },
      );
    }

    let stored: typeof schema.specs.$inferSelect | undefined;

    await runTurn({
      sessionId,
      failedMessage: "The interviewer turn failed.",
      record: { turnKind: "synthesize-spec", model: session!.model },
      take: async (recorder) => {
        const rows = await db
          .select()
          .from(schema.decisions)
          .where(eq(schema.decisions.sessionId, sessionId))
          // `createdAt` has millisecond precision; id as a final tie-break
          // keeps the spec's decision order deterministic when two decisions
          // land in the same millisecond.
          .orderBy(schema.decisions.createdAt, schema.decisions.id);

        const outOfScope = rows
          .filter(
            (row) =>
              row.answerKind === "dispositioned" &&
              row.dispositionTarget === "out-of-scope",
          )
          .map(formatDisposition);
        const openQuestions = rows
          .filter(
            (row) =>
              row.answerKind === "dispositioned" &&
              row.dispositionTarget === "open-question",
          )
          .map(formatDisposition);

        const interviewer = getInterviewer();

        const accepted = await askUntilAccepted<SynthesizeSpecResult>({
          conversationId: session!.conversationId,
          recorder,
          ask: async ({ conversationId, rejectionReason, observer }) =>
            interviewer.synthesizeSpec(
              {
                kind: "synthesize-spec",
                context: {
                  sessionId: session!.id,
                  idea: session!.idea,
                  title: session!.title,
                  model: session!.model,
                  answeringMode: session!.answeringMode,
                  docsFolder: session!.docsFolder,
                  conversationId,
                  decisions: await decisionSnapshots(rows),
                },
                outOfScope,
                openQuestions,
                rejectionReason,
              },
              observer,
            ),
          reasonsToRefuse: (result) => {
            const missing = missingSpecHeadings(result.markdown);
            return missing.length === 0
              ? []
              : [
                  `The spec is missing the following required section${missing.length === 1 ? "" : "s"}: ${missing.join(", ")}.`,
                ];
          },
          exhausted: (lastReason) =>
            new TurnRejected(
              "invalid-spec",
              `The interviewer produced a spec missing required sections ${MAX_TURN_RETRIES + 1} times. Last reason: ${lastReason}`,
            ),
        });

        const now = new Date().toISOString();
        const [existing] = await db
          .select()
          .from(schema.specs)
          .where(eq(schema.specs.sessionId, sessionId))
          .limit(1);

        if (existing) {
          [stored] = await db
            .update(schema.specs)
            .set({
              markdown: accepted.result.markdown,
              current: true,
              turnId: recorder?.turnId ?? null,
              updatedAt: now,
            })
            .where(eq(schema.specs.sessionId, sessionId))
            .returning();
        } else {
          [stored] = await db
            .insert(schema.specs)
            .values({
              id: randomUUID(),
              sessionId,
              markdown: accepted.result.markdown,
              current: true,
              turnId: recorder?.turnId ?? null,
              createdAt: now,
              updatedAt: now,
            })
            .returning();
        }

        return accepted.conversationId;
      },
    });

    if (!stored) fail("Failed to store the synthesized spec.", { statusCode: 500 });

    return stored;
  },
});
