import { defineAction, fail } from "@agent-native/core/action";
import { eq } from "@agent-native/core/db/schema";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import {
  describeHandoff,
  getHandoffRow,
  handoffFingerprint,
  loadHandoffSource,
  parseBriefs,
} from "../server/handoff.js";

export default defineAction({
  description:
    "Edit a session's generated handoff: replace HANDOFF.md's markdown and/or individual briefs by ticket number. Marks the handoff edited (so regenerating asks for confirmation) and, when it was exported before, export-stale. Refuses with `handoff-missing` when none has been generated and `brief-not-found` for a ticket number without a brief. Returns the same shape as get-handoff's `handoff`.",
  schema: z.object({
    sessionId: z.string().min(1).describe("Session id"),
    markdown: z.string().optional().describe("New HANDOFF.md markdown"),
    briefs: z
      .array(
        z.object({
          ticketNumber: z.number().int().describe("Ticket number of the brief"),
          markdown: z.string().describe("New brief markdown"),
        }),
      )
      .optional()
      .describe("Briefs to replace, by ticket number"),
  }),
  run: async ({ sessionId, markdown, briefs }) => {
    const row = await getHandoffRow(sessionId);
    if (!row) {
      fail("This session has no handoff yet. Generate one first.", {
        errorCode: "handoff-missing",
        statusCode: 404,
      });
    }

    const stored = parseBriefs(row.briefsJson);
    for (const edit of briefs ?? []) {
      const brief = stored.find((candidate) => candidate.ticketNumber === edit.ticketNumber);
      if (!brief) {
        fail(`No brief for ticket ${edit.ticketNumber}.`, {
          errorCode: "brief-not-found",
          statusCode: 404,
        });
      }
      brief.markdown = edit.markdown;
    }

    const now = new Date().toISOString();
    const [updated] = await getDb()
      .update(schema.handoffs)
      .set({
        markdown: markdown ?? row.markdown,
        briefsJson: JSON.stringify(stored),
        revision: row.revision + 1,
        editedAt: now,
        updatedAt: now,
      })
      .where(eq(schema.handoffs.id, row.id))
      .returning();

    const loaded = await loadHandoffSource(sessionId);
    return describeHandoff(updated!, "source" in loaded ? handoffFingerprint(loaded.source) : null);
  },
});
