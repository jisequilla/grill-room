# Brief 05: Detect a deleted working folder, mark the export retired, gate re-export

You are implementing ticket 05 of "Export by lifetime + ADR drafts". You work only inside the git worktree you were started in.

## Step 0: confirm your base

Your worktree was created from `origin/main`. Before anything else, confirm that the existing files this ticket builds on, named under File boundaries, are present. If any is missing, stop and report; do not recreate them.

The bundle is committed in this repository, so your worktree has it. Read the spec at `.grill-room/export-by-lifetime-adr/spec.md` and your ticket at `.grill-room/export-by-lifetime-adr/issues/05-retirement-and-reexport.md`, relative to the repository root in your worktree.

## The ticket

Blocked by: 03 (merged before this brief was delegated)

### 05 Detect a deleted working folder, mark the export retired, gate re-export

On project or session open, detect that a previously exported session's working root no longer exists and mark the session's export as retired. Grill Room never deletes the folder itself. Re-export of a retired session refuses by default with a message explaining that the build is done; an explicit override recreates the working folder from the plan and clears the retired mark. HANDOFF states that cleanup is a manual repo commit.

Judged by: tests that a missing working root sets the retired mark; a retired session's export is refused; the override recreates the working half and clears the mark; a session whose working root still exists is unaffected.

## File boundaries

Files to edit:

- `grill-room/server/db/schema.ts`
- `grill-room/server/db/migrations.ts`
- `grill-room/server/export-bundle.ts`
- `grill-room/actions/export-session.ts`
- `grill-room/actions/get-session.ts`
- `grill-room/server/handoff.ts`
- `grill-room/actions/export-session.test.ts`

## Codebase facts

- sessions.lastExportFolder is a single nullable text column set after the first export; there is no retired flag on the session. (`grill-room/server/db/schema.ts:141-145`)
- get-session returns the stored row plus isModelLocked, with no check that a previously exported bundle folder still exists. (`grill-room/actions/get-session.ts:14-24`)
- export-session's only refusals are the two handoff-gate reasons; there is no retired-session refusal or override path. (`grill-room/actions/export-session.ts:26-35`)
- writeExportBundle only creates, writes and removes files under the plan's own bundleDir; nothing detects or recreates a deleted bundle folder. (`grill-room/server/export-bundle.ts:877-903`)
- renderHandoffMarkdown's delegation-lifecycle sections never mention deleting or recreating the working folder. (`grill-room/server/handoff.ts:404-455`)

## Builds on

- Ticket 03: a distinct working-root bundle folder path recorded per export, to detect when it no longer exists and to recreate on override — ticket 03 adds `a working-root bundle folder path distinct from the durable root, recorded on export` to `grill-room/server/export-bundle.ts` — check: `grep -nE "durableBundleDir|workingBundleDir" grill-room/server/export-bundle.ts`

## Proved by

Test: `grill-room/actions/export-session.test.ts`

```bash
cd grill-room && pnpm vitest run actions/export-session.test.ts
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

Otherwise run `git push -u origin HEAD`, then `gh pr create --draft` against `main`, titled `<bead id>: Detect a deleted working folder, mark the export retired, gate re-export`, with a body giving the ticket path, the files changed, the exact verification output, and anything this brief left ambiguous. Never merge, and never mark it ready — the reviewer does that once it approves.

## Report, then stop

Report:

- worktree path and branch;
- the PR URL, or "push pending: gh account" with your commit hash;
- commits and files changed;
- the exact output of `just check`;
- anything ambiguous, and anything this brief was missing.

A separate reviewer reviews the work before any merge.

Then stop. Do no further work of any kind.
