import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { planExportBundle, writeExportBundle } from "../server/export-bundle.js";

export default defineAction({
  description:
    "Export a session's current spec, and its tickets when current, into one bundle directory in its project: <root>/<exportFolder>/<folderName>/spec.md plus issues/NN-slug.md per ticket, where folderName is the project's slug pattern applied to the given slug. Creates missing folders; re-export overwrites the bundle's spec and issue files and removes issue files the session no longer has. Writes exactly what preview-export lists, and refuses any path that resolves outside the real project root.",
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
    return {
      slug: plan.slug,
      folderName: plan.folderName,
      bundleDir: plan.bundleDir,
      files: written,
      removed,
      ticketsExported: plan.ticketsExported,
      ticketsSkippedReason: plan.ticketsSkippedReason,
    };
  },
});
