import { defineAction, fail } from "@agent-native/core/action";
import { eq } from "@agent-native/core/db/schema";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { planExportBundle, writeExportBundle } from "../server/export-bundle.js";
import { recordHandoffExport } from "../server/handoff.js";
import { buildVisibilityReport } from "../server/visibility.js";

export default defineAction({
  description:
    "Export a session's current spec, and its tickets when current, into one bundle directory in its project: <root>/<exportFolder>/<folderName>/spec.md, decisions.md (rendered from the settled tree, when the session decided something of its own or set something out of scope), issues/NN-slug.md per ticket, and HANDOFF.md plus briefs/NN-slug.md from the session's generated handoff (whose bundle paths are filled in and whose export is then recorded), where folderName is the project's slug pattern applied to the given slug. Creates missing folders; re-export overwrites the bundle's spec, issue and handoff files and removes exactly the files the previous export's manifest lists that the new export no longer writes. Refuses, writing nothing, with `handoff-missing` when the session has no handoff or `handoff-stale` when it no longer matches today's spec, tickets or project (generate or regenerate it first — see generate-handoff); preview-export reports the same gate as `exportBlocked`/`exportBlockedReason` without refusing, so the UI can explain it before the operator tries. Otherwise writes exactly what preview-export lists, and refuses any path that resolves outside the real project root. A successful export stores its bundle folder, relative to the project root, on the session. Also returns a post-export visibility report classifying every written file as tracked, ignored, or untracked, with a remedy when agents will not see it and a warning when the project's visibility flag disagrees with what was observed; see get-export-visibility to re-check without exporting again.",
  schema: z.object({
    sessionId: z.string().min(1).describe("Session id"),
    slug: z
      .string()
      .min(1)
      .describe("Slug for the bundle folder, as confirmed in the preview; sanitized before use"),
  }),
  run: async ({ sessionId, slug }) => {
    const plan = await planExportBundle({ sessionId, slug });
    if (plan.exportBlockedReason) {
      fail(
        plan.exportBlockedReason === "handoff-missing"
          ? "This session has no handoff yet. Generate one before exporting."
          : "The handoff is stale. Regenerate it before exporting.",
        { errorCode: plan.exportBlockedReason, statusCode: 409 },
      );
    }
    const { written, removed } = await writeExportBundle(plan);
    await getDb()
      .update(schema.sessions)
      .set({ lastExportFolder: plan.bundleFolder })
      .where(eq(schema.sessions.id, sessionId));
    if (plan.handoff) await recordHandoffExport(plan.handoff);
    const visibility = await buildVisibilityReport({
      root: plan.project.rootPath,
      bundleDir: plan.bundleDir,
      absolutePaths: written,
      visibility: plan.project.visibility,
    });
    return {
      slug: plan.slug,
      folderName: plan.folderName,
      bundleDir: plan.bundleDir,
      files: written,
      removed,
      ticketsExported: plan.ticketsExported,
      ticketsSkippedReason: plan.ticketsSkippedReason,
      handoffExported: plan.handoff !== null,
      visibility,
    };
  },
});
