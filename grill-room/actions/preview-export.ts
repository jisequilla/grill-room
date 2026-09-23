import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { planExportBundle } from "../server/export-bundle.js";

export default defineAction({
  description:
    "Preview a session's export without writing anything: the proposed slug (first four words of the title), the slug used, the folder name the project's slug pattern resolves to, the absolute bundle directory, every file that will be written (absolute paths: HANDOFF.md and briefs/NN-slug.md when a handoff has been generated, and the export manifest), the files the previous manifest lists that will be removed, the project's tracker diagnostic, and the export gate: `exportBlocked` and `exportBlockedReason` (`handoff-missing` or `handoff-stale`, null once a current handoff exists) that export-session actually refuses on, so the UI can explain it before the operator tries. Built by the same plan export-session writes, so the two cannot disagree.",
  schema: z.object({
    sessionId: z.string().min(1).describe("Session id"),
    slug: z
      .string()
      .optional()
      .describe("Slug to preview; the proposal from the session title when omitted"),
  }),
  http: { method: "GET" },
  run: async ({ sessionId, slug }) => {
    const plan = await planExportBundle({ sessionId, slug });
    return {
      projectId: plan.project.id,
      projectName: plan.project.name,
      projectRoot: plan.project.rootPath,
      exportFolder: plan.project.exportFolder,
      slugPattern: plan.project.slugPattern,
      proposedSlug: plan.proposedSlug,
      slug: plan.slug,
      folderName: plan.folderName,
      bundleDir: plan.bundleDir,
      bundleExists: plan.bundleExists,
      files: plan.files.map((file) => file.absolutePath),
      removals: plan.removals,
      trackerDiagnostic: plan.trackerDiagnostic,
      ticketsExported: plan.ticketsExported,
      ticketsSkippedReason: plan.ticketsSkippedReason,
      handoffIncluded: plan.handoff !== null,
      exportBlocked: plan.exportBlocked,
      exportBlockedReason: plan.exportBlockedReason,
    };
  },
});
