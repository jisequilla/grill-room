# Brief 01: Replace exportFolder with durable and working export roots

You are implementing ticket 01 of "Export by lifetime + ADR drafts". You work only inside the git worktree you were started in.

## Step 0: confirm your base

Your worktree was created from `origin/main`. Before anything else, confirm that the existing files this ticket builds on, named under File boundaries, are present. If any is missing, stop and report; do not recreate them.

The bundle is committed in this repository, so your worktree has it. Read the spec at `.grill-room/export-by-lifetime-adr/spec.md` and your ticket at `.grill-room/export-by-lifetime-adr/issues/01-two-export-roots-settings.md`, relative to the repository root in your worktree.

## The ticket

Blocked by: none

### 01 Replace exportFolder with durable and working export roots

Replace the single project export folder setting with two repo-relative roots named by lifetime: a durable export folder (default the docs specs folder) and a working export folder (default `.grill-room`). Rename the existing field rather than keeping it alongside. Validate both identically and refuse two roots that are equal or nested one inside the other. Keep the names free of the word 'docs' so they cannot collide with the session-level read-only docs folder in schema, refusal codes or UI. Update the project settings UI to show and edit both fields. Update every caller of the old field so the build stays green, even where downstream export behaviour is still single-root for now.

Judged by: settings validation tests covering two roots accepted, equal roots refused, nested roots refused (both directions), defaults applied; no remaining references to the old field; build and existing test suite green.

## File boundaries

Files to edit:

- `grill-room/server/db/schema.ts`
- `grill-room/server/db/migrations.ts`
- `grill-room/server/projects.ts`
- `grill-room/actions/register-project.ts`
- `grill-room/actions/update-project.ts`
- `grill-room/actions/refresh-project-tracker.ts`
- `grill-room/app/lib/projects.ts`
- `grill-room/app/components/projects/project-form-dialog.tsx`
- `grill-room/server/projects.test.ts`

Existing files it builds on:

- `grill-room/server/git.ts:82`
- `grill-room/shared/session-constants.ts:107`

## Codebase facts

- projects.exportFolder is one required text column with no lifetime distinction between durable and working files. (`grill-room/server/db/schema.ts:83`)
- ProjectErrorCode has no code for two export roots that are equal or nested. (`grill-room/server/projects.ts:41-57`)
- normalizeExportFolder normalizes exactly one folder against the root; there is no second-folder or collision check. (`grill-room/server/projects.ts:170-193`)
- validate() reads a single exportFolderInput and refuses export-folder-required when it is blank, with nothing analogous for a second root. (`grill-room/server/projects.ts:502-510`)
- ProjectValues, what registerProject/updateProject persist, carries one exportFolder field, not two lifetime-named roots. (`grill-room/server/projects.ts:552-567`)
- The project settings dialog binds one Input to a single exportFolder field. (`grill-room/app/components/projects/project-form-dialog.tsx:308-332`)
- ProjectField only names exportFolder, and PROJECT_ERROR has no entry for an equal-or-nested-roots refusal. (`grill-room/app/lib/projects.ts:10-44`)
- register-project's action schema exposes exportFolder as a single optional string field. (`grill-room/actions/register-project.ts:24-29`)
- Migrations are append-only; the latest shipped entry is version 63, so replacing exportFolder is a new migration entry, not an edit to an existing one. (`grill-room/server/db/migrations.ts:498-501`)
- projects.test.ts already exercises export-folder-required, folder-not-absolute and export-folder-is-root against the single exportFolder field, so it is the place to extend for two roots. (`grill-room/server/projects.test.ts:43-58`)

## Proved by

Test: `grill-room/server/projects.test.ts`

```bash
cd grill-room && pnpm vitest run server/projects.test.ts
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

Otherwise run `git push -u origin HEAD`, then `gh pr create --draft` against `main`, titled `<bead id>: Replace exportFolder with durable and working export roots`, with a body giving the ticket path, the files changed, the exact verification output, and anything this brief left ambiguous. Never merge, and never mark it ready — the reviewer does that once it approves.

## Report, then stop

Report:

- worktree path and branch;
- the PR URL, or "push pending: gh account" with your commit hash;
- commits and files changed;
- the exact output of `just check`;
- anything ambiguous, and anything this brief was missing.

A separate reviewer reviews the work before any merge.

Then stop. Do no further work of any kind.
