import { defineAction, fail } from "@agent-native/core/action";
import { eq } from "@agent-native/core/db/schema";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { planExportBundle, writeExportBundle } from "../server/export-bundle.js";
import { recordHandoffExport } from "../server/handoff.js";
import { buildVisibilityReport } from "../server/visibility.js";

export default defineAction({
  description:
    "Export a session's current spec, and its tickets when current, into one bundle directory in its project: <root>/<exportFolder>/<folderName>/spec.md, intent.md, decisions.md (rendered from the settled tree, when the session decided something of its own or set something out of scope), issues/NN-slug.md per ticket, and HANDOFF.md plus briefs/NN-slug.md from the session's generated handoff, re-rendered fresh with the session's current brief grounding wherever it has not been hand-edited (whose bundle paths are filled in and whose export is then recorded), where folderName is the project's slug pattern applied to the given slug. Creates missing folders and writes a provenance manifest (.grill-room-export.json: session id, export revision, scout commit, HEAD at export, and a CRLF-insensitive sha256 of every file written). Re-export removes files the previous manifest lists that the new export no longer writes. Edited files are kept: a planned file or removal already on disk that no longer matches the hash the previous manifest recorded, or that the previous manifest never listed, is neither overwritten nor removed unless its bundle-relative path is in `overridePaths` (a version-1 manifest's files are trusted as unedited once). The check is repeated from disk at write time, so a file edited after preview-export is kept unless overridden. An override resolving outside the bundle is refused with `override-outside-bundle`. Refuses, writing nothing, with `handoff-missing` when the session has no handoff or `handoff-stale` when it no longer matches today's spec, tickets or project (generate or regenerate it first — see generate-handoff); preview-export reports the same gate as `exportBlocked`/`exportBlockedReason` without refusing, and marks each edited file, so the UI can explain both before the operator tries. Refuses any path that resolves outside the real project root. A successful export stores its bundle folder, relative to the project root, on the session. Returns `written`, `removed` and `kept` as absolute paths, `groundedBriefs`/`ungroundedBriefs` (ticket numbers written fresh with the current grounding versus exactly as hand-edited), plus a post-export visibility report classifying every written file as tracked, ignored, or untracked, with a remedy when agents will not see it and a warning when the project's visibility flag disagrees with what was observed; see get-export-visibility to re-check without exporting again.",
  schema: z.object({
    sessionId: z.string().min(1).describe("Session id"),
    slug: z
      .string()
      .min(1)
      .describe("Slug for the bundle folder, as confirmed in the preview; sanitized before use"),
    overridePaths: z
      .array(z.string())
      .optional()
      .describe(
        "Bundle-relative paths (preview-export's `relativePath`) of edited files to overwrite or remove anyway",
      ),
  }),
  run: async ({ sessionId, slug, overridePaths }) => {
    const plan = await planExportBundle({ sessionId, slug, overridePaths });
    if (plan.exportBlockedReason) {
      fail(
        plan.exportBlockedReason === "handoff-missing"
          ? "This session has no handoff yet. Generate one before exporting."
          : "The handoff is stale. Regenerate it before exporting.",
        { errorCode: plan.exportBlockedReason, statusCode: 409 },
      );
    }
    const { written, removed, kept } = await writeExportBundle(plan);
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
      written,
      removed,
      kept,
      ticketsExported: plan.ticketsExported,
      ticketsSkippedReason: plan.ticketsSkippedReason,
      handoffExported: plan.handoff !== null,
      groundedBriefs: plan.groundedBriefs,
      ungroundedBriefs: plan.ungroundedBriefs,
      visibility,
    };
  },
});
