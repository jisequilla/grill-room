# Brief 03: Plan and write the export bundle across two roots with one manifest per root

You are implementing ticket 03 of "Export by lifetime + ADR drafts". You work only inside the git worktree you were started in.

## Step 0: confirm your base

Your worktree was created from `origin/main`. Before anything else, confirm that the existing files this ticket builds on, named under File boundaries, are present. If any is missing, stop and report; do not recreate them.

The bundle is committed in this repository, so your worktree has it. Read the spec at `.grill-room/export-by-lifetime-adr/spec.md` and your ticket at `.grill-room/export-by-lifetime-adr/issues/03-export-plan-two-roots.md`, relative to the repository root in your worktree.

## The ticket

Blocked by: 01 (merged before this brief was delegated)

### 03 Plan and write the export bundle across two roots with one manifest per root

Extend the export plan so it remains the single source of truth for layout across both roots. Assign spec, decisions and intent to the durable root and issues, HANDOFF, briefs and the manifest to the working root, each under the same session slug as the leaf folder. Write one manifest per root. Run the edited-file guard, containment checks and export gate per root using that root's own manifest, so hand edits in the durable root are protected even after the working root is deleted. All links between the two halves (HANDOFF and briefs to spec and decisions, spec to tickets) are repo-root-relative.

Judged by: plan tests asserting file-to-root assignment and shared slug; manifest tests showing two manifests with the right entries; guard tests showing a hand-edited durable file is kept on re-export when the working manifest is absent; link tests asserting repo-root-relative paths in HANDOFF, briefs and spec.

## File boundaries

Files to edit:

- `grill-room/server/export.ts`
- `grill-room/server/export-bundle.ts`
- `grill-room/server/handoff.ts`
- `grill-room/actions/preview-export.test.ts`

Existing files it builds on:

- `grill-room/server/tickets.ts:258-279`
- `grill-room/server/tree.ts:451-498`

## Codebase facts

- ExportPlan is one flat list of files with no grouping by lifetime. (`grill-room/server/export.ts:41-44`)
- planExport pushes spec.md, intent.md, decisions.md and every ticket file into that one list, with no split between durable and working files. (`grill-room/server/export.ts:735-770`)
- ExportBundlePlan resolves a single bundleDir under one project.exportFolder and reports one bundleFolder. (`grill-room/server/export-bundle.ts:245-260`)
- planExportBundle computes a single exportDir from project.exportFolder and derives one bundleDir/folderName from it. (`grill-room/server/export-bundle.ts:591-599`)
- readPreviousManifest and the removal/edit-guard logic are all keyed to one bundleDir and one manifest file, not one per root. (`grill-room/server/export-bundle.ts:398-419`)
- HandoffSource.project carries a single rootPath/exportFolder/visibility, with no durable/working split. (`grill-room/server/handoff.ts:68-86`)
- bundlePathFor computes one bundle path from one visibility flag and one bundleDir. (`grill-room/server/handoff.ts:244-253`)
- pathsNote describes paths relative to a single project.rootPath/exportFolder pair, not two roots. (`grill-room/server/handoff.ts:293-305`)

## Builds on

- Ticket 01: the two lifetime-named export root fields (durable, working) to assign spec/decisions/intent versus issues/HANDOFF/briefs/manifest against — ticket 01 adds `durableExportFolder and workingExportFolder fields on the validated project` to `grill-room/server/projects.ts` — check: `grep -n "durableExportFolder" grill-room/server/projects.ts`

## Proved by

Test: `grill-room/actions/preview-export.test.ts`

```bash
cd grill-room && pnpm vitest run actions/preview-export.test.ts
```

## Rules

- Create and edit files only within the file boundaries above. If the ticket cannot be done inside them, stop and report instead of widening them.
- Run git only inside your worktree. Never run git against another checkout, never commit directly on `main`, and never merge anything.
- Commit on your worktree branch as you go.

## Verify

From the repository root in your worktree, this must exit 0:

```bash
just check
```

## Delivery

When verification passes, run `gh auth status`. If the active account is not the one this repository expects, do not switch it: stop after committing and report "push pending: gh account" with your commit hash.

Otherwise run `git push -u origin HEAD`, then `gh pr create --draft` against `main`, titled `<bead id>: Plan and write the export bundle across two roots with one manifest per root`, with a body giving the ticket path, the files changed, the exact verification output, and anything this brief left ambiguous. Never merge, and never mark it ready — the reviewer does that once it approves.

## Report, then stop

Report:

- worktree path and branch;
- the PR URL, or "push pending: gh account" with your commit hash;
- commits and files changed;
- the exact output of `just check`;
- anything ambiguous, and anything this brief was missing.

A separate reviewer reviews the work before any merge.

Then stop. Do no further work of any kind.
