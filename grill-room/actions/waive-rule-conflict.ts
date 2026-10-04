import { randomUUID } from "node:crypto";
import path from "node:path";

import { defineAction, fail } from "@agent-native/core/action";
import { eq } from "@agent-native/core/db/schema";
import { z } from "zod";

import { currentBriefGrounding } from "../server/brief-grounding.js";
import { getDb, schema } from "../server/db/index.js";
import { handoffGroundingOf, loadRuleConflictLists } from "../server/export-bundle.js";
import {
  citationPath,
  getHandoffRow,
  loadHandoffSource,
  partitionRuleConflicts,
} from "../server/handoff.js";

const REFUSAL_STATUS: Record<string, number> = {
  "session-not-found": 404,
  "project-not-found": 404,
};

function sameFiles(a: readonly string[], b: readonly string[]): boolean {
  const left = new Set(a.map((file) => path.posix.normalize(file)));
  const right = new Set(b.map((file) => path.posix.normalize(file)));
  return left.size === right.size && [...left].every((file) => right.has(file));
}

export default defineAction({
  description:
    "Accept one open rule conflict as is, with a reason: a repository rule requires files outside a ticket's file boundaries, and the owner means the ticket to leave them alone. The conflict is the one `preview-export` lists in `ruleConflicts` with this ticket, citation and set of missing files. The waiver is keyed by the ticket, the rule file (the citation without its line) and the missing files, so it accepts every conflict on that rule file with those missing files, and it survives a re-grounding that finds the same conflict; with any other missing files, rule file or ticket it applies to nothing. Accepted conflicts render with their reason in HANDOFF and the brief instead of as open questions. A waiver never changes the handoff's fingerprint, so the handoff and the grounding stay current. The reason has its whitespace runs collapsed to one space and must then be 1 to 500 characters. Refuses with 404 for an unknown session, `handoff-missing` (409) when the session has no handoff, the handoff source's own refusal code when it cannot load, and `no-such-conflict` (409) when no open conflict matches; nothing is written. Returns `{ waiverId, ruleConflicts, acceptedRuleConflicts }` in the shape `preview-export` reports.",
  schema: z.object({
    sessionId: z.string().min(1).describe("Session id"),
    ticket: z.number().int().describe("The ticket number of the conflict"),
    citation: z.string().min(1).describe("The conflict's citation, as `preview-export` lists it"),
    missingFiles: z
      .array(z.string().min(1))
      .min(1)
      .describe("The conflict's missing files, as `preview-export` lists them"),
    reason: z
      .string()
      .transform((value) => value.replace(/\s+/g, " ").trim())
      .pipe(z.string().min(1).max(500))
      .describe("Why the ticket leaves these files alone"),
  }),
  run: async ({ sessionId, ticket, citation, missingFiles, reason }) => {
    const db = getDb();
    const [session] = await db
      .select()
      .from(schema.sessions)
      .where(eq(schema.sessions.id, sessionId))
      .limit(1);
    if (!session) fail(`Session not found: ${sessionId}`, { statusCode: 404 });

    if (!(await getHandoffRow(sessionId))) {
      fail("This session has no handoff, so it has no rule conflicts to accept. Generate the handoff first.", {
        errorCode: "handoff-missing",
        statusCode: 409,
      });
    }

    const loaded = await loadHandoffSource(sessionId);
    if ("refusal" in loaded) {
      fail(loaded.refusal.message, {
        errorCode: loaded.refusal.errorCode,
        statusCode: REFUSAL_STATUS[loaded.refusal.errorCode] ?? 409,
      });
    }

    const grounding = handoffGroundingOf(await currentBriefGrounding(sessionId));
    const conflict = partitionRuleConflicts(loaded.source, grounding).open.find(
      (candidate) =>
        candidate.ticket === ticket &&
        candidate.citation === citation &&
        sameFiles(candidate.missingFiles, missingFiles),
    );
    const ticketRow = loaded.source.tickets.find((candidate) => candidate.number === ticket);
    if (!conflict || !ticketRow) {
      fail("No open rule conflict matches that ticket, citation and missing files.", {
        errorCode: "no-such-conflict",
        statusCode: 409,
      });
    }

    const waiverId = randomUUID();
    await db.insert(schema.ruleWaivers).values({
      id: waiverId,
      sessionId,
      ticketId: ticketRow.id,
      rulePath: citationPath(conflict.citation),
      missingFilesJson: JSON.stringify(conflict.missingFiles),
      reason,
      createdAt: new Date().toISOString(),
    });

    return { waiverId, ...(await loadRuleConflictLists(sessionId)) };
  },
});
