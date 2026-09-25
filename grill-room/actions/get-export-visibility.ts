import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { planExportBundle } from "../server/export-bundle.js";
import { buildVisibilityReport } from "../server/visibility.js";

export default defineAction({
  description:
    "Re-check a session's export visibility without exporting again: classifies every file the same export would write (or already wrote) as tracked, ignored, untracked, or unchecked (\"could not check\": git could not tell, e.g. the file sits behind a symlink check-ignore refuses to resolve) in the target repository, with a remedy when agents will not see it, a warning naming each unchecked file's git error, and a warning when the project's visibility flag disagrees with what was observed. Takes the same sessionId and slug as preview-export and export-session, and builds the same plan, so it always asks about the files the current export would touch — whether or not export-session has run yet.",
  schema: z.object({
    sessionId: z.string().min(1).describe("Session id"),
    slug: z
      .string()
      .min(1)
      .describe("Slug for the bundle folder, as confirmed in the preview; sanitized before use"),
  }),
  http: { method: "GET" },
  run: async ({ sessionId, slug }) => {
    const plan = await planExportBundle({ sessionId, slug });
    return buildVisibilityReport({
      root: plan.project.rootPath,
      bundleDir: plan.bundleDir,
      absolutePaths: plan.files.map((file) => file.absolutePath),
      visibility: plan.project.visibility,
    });
  },
});
