import { defineAction, fail } from "@agent-native/core/action";
import { z } from "zod";

import {
  describeHandoff,
  getHandoffRow,
  handoffFingerprint,
  loadHandoffSource,
  renderHandoff,
  saveGeneratedHandoff,
} from "../server/handoff.js";

const REFUSAL_STATUS: Record<string, number> = {
  "session-not-found": 404,
  "project-not-found": 404,
};

export default defineAction({
  description:
    "Generate or regenerate a session's handoff from deterministic templates (no model call): HANDOFF.md (spec path, ticket waves with brief links, verify command, the PR-based worktree lifecycle, what to record per ticket, bead commands or per-ticket Status lines by tracker kind, build-record commands when the project logs them, tracked or ignored path variant by the project's visibility flag) and one brief per ticket with empty File boundaries and Codebase facts slots. Refuses with `no-project`, `project-not-found`, `spec-missing`, `no-tickets` or `ticket-cycle`, and with `handoff-edited` when the stored handoff carries UI edits unless `overwriteEdits` is true. Returns the same shape as get-handoff's `handoff`.",
  schema: z.object({
    sessionId: z.string().min(1).describe("Session id"),
    overwriteEdits: z
      .boolean()
      .optional()
      .describe("Confirm replacing a handoff that was edited since it was generated"),
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
    if (existing?.editedAt && overwriteEdits !== true) {
      fail("The handoff was edited since it was generated. Confirm to overwrite the edits.", {
        errorCode: "handoff-edited",
        statusCode: 409,
      });
    }

    const fingerprint = handoffFingerprint(loaded.source);
    const row = await saveGeneratedHandoff(sessionId, renderHandoff(loaded.source), fingerprint);
    return describeHandoff(row, fingerprint);
  },
});
