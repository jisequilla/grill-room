import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { planExportBundle } from "../server/export-bundle.js";

export default defineAction({
  description:
    "Preview a session's export without writing anything: the proposed slug (first four words of the title), the slug used, the folder name the project's slug pattern resolves to, the absolute bundle directory, every file that will be written (absolute paths: decisions.md when the tree holds decisions or out-of-scope items, HANDOFF.md and briefs/NN-slug.md when a handoff has been generated, and the export manifest), the files the previous manifest lists that the plan drops, the project's tracker diagnostic, and the export gate: `exportBlocked` and `exportBlockedReason` (`handoff-missing` or `handoff-stale`, null once a current handoff exists) that export-session actually refuses on, so the UI can explain it before the operator tries. `plannedWrites` and `plannedRemovals` repeat every planned write and removal as `{ path, relativePath, edited }`: `edited` is true when the file on disk no longer matches the hash the previous manifest recorded for it, or was never written by Grill Room at all. export-session keeps an edited file (neither overwrites nor removes it) unless its `relativePath` is passed in `overridePaths`. Built by the same plan export-session writes, so the two cannot disagree; export-session checks for edits again when it writes, so this preview is not a lock. Also reports the session's brief grounding state as `groundingState` (`absent`, `current`, or `stale`) and `groundingStaleReason` (`head-moved` or `handoff-changed`, null while current or absent) — informational only, never blocking export. `groundedBriefs` lists the ticket numbers of briefs this plan actually writes grounded (eligible for a fresh render, and the session's grounding — current or stale — has an entry for that ticket); `ungroundedBriefs` lists every other brief as `{ ticket, reason }`, `reason` one of `edited` (a hand edit's text no longer matches an ungrounded render), `no-grounding` (eligible, but the session has no grounding at all), `not-covered` (eligible and grounded, but that grounding has no entry for this ticket), or `kept` (would be grounded, but the file already on disk was edited since the last export and the hash guard is keeping it, so the grounded text was never written) — so a brief the grounding skipped is never invisible.",
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
      removals: plan.removals.map((removal) => removal.absolutePath),
      plannedWrites: plan.files.map((file) => ({
        path: file.absolutePath,
        relativePath: file.relativePath,
        edited: file.edited,
      })),
      plannedRemovals: plan.removals.map((removal) => ({
        path: removal.absolutePath,
        relativePath: removal.relativePath,
        edited: removal.edited,
      })),
      trackerDiagnostic: plan.trackerDiagnostic,
      ticketsExported: plan.ticketsExported,
      ticketsSkippedReason: plan.ticketsSkippedReason,
      handoffIncluded: plan.handoff !== null,
      exportBlocked: plan.exportBlocked,
      exportBlockedReason: plan.exportBlockedReason,
      groundingState: plan.briefGroundingState,
      groundingStaleReason: plan.briefGroundingStaleReason,
      groundedBriefs: plan.groundedBriefs,
      ungroundedBriefs: plan.ungroundedBriefs,
    };
  },
});
