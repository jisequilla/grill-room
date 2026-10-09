import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { planExportBundle } from "../server/export-bundle.js";

export default defineAction({
  description:
    "Preview a session's export without writing anything: the proposed slug (first four words of the title), the slug used, the folder name the project's slug pattern resolves to (one name shared by both roots), the absolute working bundle directory (`bundleDir`) and durable bundle directory (`durableBundleDir`, with `durableBundleExists` and `durableBundlePath`, the durable folder as HANDOFF.md would name it: repo-relative unless git ignores it, absolute when it does), `bundlePath`, what `{{BUNDLE}}` becomes in HANDOFF.md and the briefs for this plan (`durableBundlePath` is what `{{DOCS}}` becomes), every file that will be written, durable root first (absolute paths: spec.md, intent.md and decisions.md to the durable root, decisions.md when the tree holds decisions or out-of-scope items, HANDOFF.md, issues and briefs/NN-slug.md to the working root, and an export manifest in each), the files a root's previous manifest lists that the plan drops, the project's tracker diagnostic, and the export gate: `exportBlocked` and `exportBlockedReason` (`handoff-missing`, `handoff-stale`, `durable-folder-ignored` or `export-retired`, null once a current handoff exists, the durable folder is not confirmed ignored and the export is not retired) and `durableFolderIgnored` (whether git confirms the durable bundle folder is ignored, reported whatever the handoff says) that export-session actually refuses on, so the UI can explain it before the operator tries. `exportRetired` is true when the session's last export is retired (the working folder its durable manifest names was deleted) and `retiredWorkingFolder` names that folder, otherwise null; `export-retired` is reported after every other reason, and `reexportRetired: true` clears it as it does for export-session. `plannedWrites` and `plannedRemovals` repeat every planned write and removal as `{ path, root, relativePath, rootRelativePath, edited }` (`root` is `durable` or `working`, `relativePath` is bundle-relative, `rootRelativePath` is project-root-relative): `edited` is true when the file on disk no longer matches the hash the previous manifest recorded for it, or was never written by Grill Room at all. export-session keeps an edited file (neither overwrites nor removes it) unless its `rootRelativePath` is passed in `overridePaths`. Built by the same plan export-session writes, so the two cannot disagree; export-session checks for edits again when it writes, so this preview is not a lock. Also reports the session's brief grounding state as `groundingState` (`absent`, `current`, or `stale`) and `groundingStaleReason` (`head-moved` or `handoff-changed`, null while current or absent) — informational only, never blocking export. `groundedBriefs` lists the ticket numbers of briefs this plan actually writes grounded (eligible for a fresh render, and the session's grounding — current or stale — has an entry for that ticket); `ungroundedBriefs` lists every other brief as `{ ticket, reason }`, `reason` one of `edited` (no longer matches its generated baseline (or, with no baseline, today's ungrounded render)), `no-grounding` (eligible, but the session has no grounding at all), `not-covered` (eligible and grounded, but that grounding has no entry for this ticket), or `kept` (would be grounded, but the file already on disk was edited since the last export and the hash guard is keeping it, so the grounded text was never written) — so a brief the grounding skipped is never invisible. `delegationProposals` lists the delegation values the session's grounding proposes that the owner has neither confirmed nor dismissed, each as `{ slot, proposal, confirmed }` (`confirmed` is the slot's confirmed value or null), from a current or stale grounding and empty with none; it never blocks export. `ruleConflicts` lists each open rule conflict of the grounding (current or stale) as `{ ticket, title, citation, statement, missingFiles }`: a rule claim whose required files fall outside the ticket's file boundaries and that the owner has not accepted as is, empty with no handoff or no grounding; advisory, it never blocks export. `acceptedRuleConflicts` lists the conflicts the owner accepted, each as a conflict plus `{ waiverId, reason }`; also advisory, and a waiver never changes the handoff's fingerprint.",
  schema: z.object({
    sessionId: z.string().min(1).describe("Session id"),
    slug: z
      .string()
      .optional()
      .describe("Slug to preview; the proposal from the session title when omitted"),
    reexportRetired: z
      .boolean()
      .optional()
      .describe(
        "Preview as export-session would with reexportRetired: true, so a retired export is not reported as blocked; omit it otherwise",
      ),
  }),
  http: { method: "GET" },
  run: async ({ sessionId, slug, reexportRetired }) => {
    const plan = await planExportBundle({ sessionId, slug, reexportRetired });
    return {
      projectId: plan.project.id,
      projectName: plan.project.name,
      projectRoot: plan.project.rootPath,
      workingExportFolder: plan.project.workingExportFolder,
      durableExportFolder: plan.project.durableExportFolder,
      slugPattern: plan.project.slugPattern,
      proposedSlug: plan.proposedSlug,
      slug: plan.slug,
      folderName: plan.folderName,
      bundleDir: plan.bundleDir,
      bundlePath: plan.bundlePath,
      bundleExists: plan.bundleExists,
      durableBundleDir: plan.durableBundleDir,
      durableBundlePath: plan.durableBundlePath,
      durableBundleExists: plan.durableBundleExists,
      files: plan.files.map((file) => file.absolutePath),
      removals: plan.removals.map((removal) => removal.absolutePath),
      plannedWrites: plan.files.map((file) => ({
        path: file.absolutePath,
        root: file.root,
        relativePath: file.relativePath,
        rootRelativePath: file.rootRelativePath,
        edited: file.edited,
      })),
      plannedRemovals: plan.removals.map((removal) => ({
        path: removal.absolutePath,
        root: removal.root,
        relativePath: removal.relativePath,
        rootRelativePath: removal.rootRelativePath,
        edited: removal.edited,
      })),
      trackerDiagnostic: plan.trackerDiagnostic,
      ticketsExported: plan.ticketsExported,
      ticketsSkippedReason: plan.ticketsSkippedReason,
      handoffIncluded: plan.handoff !== null,
      exportBlocked: plan.exportBlocked,
      exportBlockedReason: plan.exportBlockedReason,
      durableFolderIgnored: plan.durableFolderIgnored,
      exportRetired: plan.exportRetired,
      retiredWorkingFolder: plan.retiredWorkingFolder,
      groundingState: plan.briefGroundingState,
      groundingStaleReason: plan.briefGroundingStaleReason,
      groundedBriefs: plan.groundedBriefs,
      ungroundedBriefs: plan.ungroundedBriefs,
      delegationProposals: plan.delegationProposals,
      ruleConflicts: plan.ruleConflicts,
      acceptedRuleConflicts: plan.acceptedRuleConflicts,
    };
  },
});
