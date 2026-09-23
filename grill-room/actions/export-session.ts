import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { planExportBundle, writeExportBundle } from "../server/export-bundle.js";
import { recordHandoffExport } from "../server/handoff.js";
import { buildVisibilityReport } from "../server/visibility.js";

export default defineAction({
  description:
    "Export a session's current spec, and its tickets when current, into one bundle directory in its project: <root>/<exportFolder>/<folderName>/spec.md plus issues/NN-slug.md per ticket, and HANDOFF.md plus briefs/NN-slug.md when the session has a generated handoff (whose bundle paths are filled in and whose export is then recorded), where folderName is the project's slug pattern applied to the given slug. Creates missing folders; re-export overwrites the bundle's spec and issue files and removes exactly the files the previous export's manifest lists that the new export no longer writes. Writes exactly what preview-export lists, and refuses any path that resolves outside the real project root. Also returns a post-export visibility report classifying every written file as tracked, ignored, or untracked, with a remedy when agents will not see it and a warning when the project's visibility flag disagrees with what was observed; see get-export-visibility to re-check without exporting again.",
  schema: z.object({
    sessionId: z.string().min(1).describe("Session id"),
    slug: z
      .string()
      .min(1)
      .describe("Slug for the bundle folder, as confirmed in the preview; sanitized before use"),
  }),
  run: async ({ sessionId, slug }) => {
    const plan = await planExportBundle({ sessionId, slug });
    const { written, removed } = await writeExportBundle(plan);
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
