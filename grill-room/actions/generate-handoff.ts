import { defineAction, fail } from "@agent-native/core/action";
import { z } from "zod";

import {
  describeHandoff,
  getHandoffRow,
  handoffFingerprint,
  loadHandoffSource,
  regenerateHandoff,
  renderHandoff,
  saveGeneratedHandoff,
  storedHandoffText,
} from "../server/handoff.js";

const REFUSAL_STATUS: Record<string, number> = {
  "session-not-found": 404,
  "project-not-found": 404,
};

export default defineAction({
  description:
    "Generate or regenerate a session's handoff from deterministic templates (no model call): HANDOFF.md (spec path, ticket waves with brief links, verify command, the PR-based worktree lifecycle, what to record per ticket, bead commands or per-ticket Status lines by tracker kind, build-record commands when the project logs them, tracked or ignored path variant by the project's visibility flag) and one brief per ticket with empty File boundaries and Codebase facts slots. Regenerating rewrites every unedited text and keeps each hand-edited brief whose ticket still exists, word for word; the result's `editedBriefs` names the briefs kept and `outdatedBriefs` those whose ticket, project or template changed since, to review. Refuses with `no-project`, `project-not-found`, `spec-missing`, `no-tickets` or `ticket-cycle`, and with `handoff-edited` when regenerating would lose an edit (HANDOFF.md was edited, an edited brief's ticket is gone, or a handoff stored before edits were tracked per text was edited) unless `overwriteEdits` is true, which rewrites everything. Returns the same shape as get-handoff's `handoff`.",
  schema: z.object({
    sessionId: z.string().min(1).describe("Session id"),
    overwriteEdits: z
      .boolean()
      .optional()
      .describe("Confirm replacing every text of the handoff, edited or not"),
  }),
  run: async ({ sessionId, overwriteEdits }) => {
    const loaded = await loadHandoffSource(sessionId);
    if ("refusal" in loaded) {
      fail(loaded.refusal.message, {
        errorCode: loaded.refusal.errorCode,
        statusCode: REFUSAL_STATUS[loaded.refusal.errorCode] ?? 409,
      });
    }

    const existing = await getHandoffRow(sessionId);
    const outcome = regenerateHandoff(
      existing ? storedHandoffText(existing) : null,
      renderHandoff(loaded.source),
      overwriteEdits === true,
    );
    if ("refusal" in outcome) {
      fail(outcome.refusal, { errorCode: "handoff-edited", statusCode: 409 });
    }

    const row = await saveGeneratedHandoff(sessionId, outcome.handoff, handoffFingerprint(loaded.source));
    return describeHandoff(row, loaded.source);
  },
});
