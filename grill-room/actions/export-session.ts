import { defineAction, fail } from "@agent-native/core/action";
import { eq } from "@agent-native/core/db/schema";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { planExportBundle, writeExportBundle } from "../server/export-bundle.js";
import { recordHandoffExport } from "../server/handoff.js";
import { buildVisibilityReport } from "../server/visibility.js";

export default defineAction({
  description:
    "Export a session's current spec, and its tickets when current, into its project, split by lifetime across two bundle folders sharing one folderName: the durable files <root>/<durableExportFolder>/<folderName>/spec.md, intent.md and decisions.md (rendered from the settled tree, when the session decided something of its own or set something out of scope), and the working files <root>/<workingExportFolder>/<folderName>/issues/NN-slug.md per ticket, and HANDOFF.md plus briefs/NN-slug.md from the session's generated handoff, re-rendered fresh with the session's current brief grounding wherever it has not been hand-edited (whose bundle paths are filled in and whose export is then recorded), where folderName is the project's slug pattern applied to the given slug. Creates missing folders and writes a provenance manifest in each bundle folder (.grill-room-export.json, version 3: session id, that root's export revision, which root it is, the other root's bundle folder, scout commit, HEAD at export, and a CRLF-insensitive sha256 of every file written in that folder). Re-export removes files a root's previous manifest lists that the new export no longer writes in that root. Edited files are kept: a planned file or removal already on disk that no longer matches the hash its root's previous manifest recorded, or that the manifest never listed, is neither overwritten nor removed unless its project-root-relative path (preview-export's `rootRelativePath`, e.g. docs/specs/<folderName>/spec.md) is in `overridePaths` (a version-1 manifest's files are trusted as unedited once). The check is repeated from disk at write time, so a file edited after preview-export is kept unless overridden. An override resolving, through symlinks, inside neither bundle folder is refused with `override-outside-bundle`. Refuses, writing nothing, with `handoff-missing` when the session has no handoff or `handoff-stale` when it no longer matches today's spec, tickets or project (generate or regenerate it first — see generate-handoff); preview-export reports the same gate as `exportBlocked`/`exportBlockedReason` without refusing, and marks each edited file, so the UI can explain both before the operator tries. Refuses any path that resolves outside the real project root. A successful export stores both bundle folders, relative to the project root, on the session. Returns `bundleDir` (the working bundle folder) and `durableBundleDir`, and `written`, `removed` and `kept` as absolute paths, durable root first, `groundedBriefs` (ticket numbers actually written grounded) and `ungroundedBriefs` (every other brief written, as `{ ticket, reason }` — `edited`, `no-grounding`, `not-covered`, or `kept` when the hash guard left an already-edited copy on disk instead of writing the grounded text), plus a post-export visibility report classifying every written file of both roots as tracked, ignored, untracked, or unchecked (\"could not check\": git could not tell, e.g. the file sits behind a symlink check-ignore refuses to resolve), with a remedy staging the bundle folders that hold an untracked file, a warning naming each unchecked file's git error, and a warning when the project's visibility flag disagrees with what was observed in the working folder; see get-export-visibility to re-check without exporting again.",
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
        "Project-root-relative paths (preview-export's `rootRelativePath`, e.g. docs/specs/<folderName>/spec.md) of edited files to overwrite or remove anyway; a bundle-relative path such as spec.md is refused with override-outside-bundle",
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
      .set({
        lastWorkingExportFolder: plan.bundleFolder,
        lastDurableExportFolder: plan.durableBundleFolder,
      })
      .where(eq(schema.sessions.id, sessionId));
    if (plan.handoff) await recordHandoffExport(plan.handoff);
    const visibility = await buildVisibilityReport({
      root: plan.project.rootPath,
      bundleDirs: [plan.durableBundleDir, plan.bundleDir],
      workingBundleDir: plan.bundleDir,
      absolutePaths: written,
      visibility: plan.project.visibility,
    });
    return {
      slug: plan.slug,
      folderName: plan.folderName,
      bundleDir: plan.bundleDir,
      durableBundleDir: plan.durableBundleDir,
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
