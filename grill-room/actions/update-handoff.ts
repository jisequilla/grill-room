import { defineAction, fail } from "@agent-native/core/action";
import { eq } from "@agent-native/core/db/schema";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import {
  baselineAfterEdit,
  describeHandoff,
  getHandoffRow,
  handoffFingerprint,
  loadHandoffSource,
  parseBriefs,
} from "../server/handoff.js";

export default defineAction({
  description:
    "Edit a session's generated handoff: replace HANDOFF.md's markdown and/or individual briefs by ticket number. Marks the handoff edited and, when it was exported before, export-stale. Regenerating later keeps each edited brief whose ticket still exists and refuses over an edited HANDOFF.md unless confirmed. Saving an edited brief while the handoff is current marks it reviewed: it drops out of `outdatedBriefs`. Refuses with `handoff-missing` when none has been generated and `brief-not-found` for a ticket number without a brief. Returns the same shape as get-handoff's `handoff`.",
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

    const loaded = await loadHandoffSource(sessionId);
    const source = "source" in loaded ? loaded.source : null;
    const context = {
      legacy: row.markdownGeneratedSha256 === null,
      current: source !== null && handoffFingerprint(source) === row.fingerprint,
      source,
    };

    const stored = parseBriefs(row.briefsJson);
    for (const edit of briefs ?? []) {
      const brief = stored.find((candidate) => candidate.ticketNumber === edit.ticketNumber);
      if (!brief) {
        fail(`No brief for ticket ${edit.ticketNumber}.`, {
          errorCode: "brief-not-found",
          statusCode: 404,
        });
      }
      const baseline = baselineAfterEdit(brief, context);
      brief.markdown = edit.markdown;
      if (baseline !== undefined) brief.generatedSha256 = baseline;
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

    return describeHandoff(updated!, source);
  },
});
