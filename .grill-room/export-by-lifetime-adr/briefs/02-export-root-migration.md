# Brief 02: Migrate existing projects to two roots and re-check visibility

You are implementing ticket 02 of "Export by lifetime + ADR drafts". You work only inside the git worktree you were started in.

## Step 0: confirm your base

Your worktree was created from `origin/main`. Before anything else, confirm that the existing files this ticket builds on, named under File boundaries, are present. If any is missing, stop and report; do not recreate them.

The bundle is committed in this repository, so your worktree has it. Read the spec at `.grill-room/export-by-lifetime-adr/spec.md` and your ticket at `.grill-room/export-by-lifetime-adr/issues/02-export-root-migration.md`, relative to the repository root in your worktree.

## The ticket

Blocked by: 01 (merged before this brief was delegated)

### 02 Migrate existing projects to two roots and re-check visibility

Add a migration for registered projects. If the existing export folder sits under the docs folder, it becomes the durable root and the working root takes its default; otherwise it becomes the working root and the durable root takes its default. On the project's next open, re-run the git ignore visibility check on both roots and store a visibility flag per root. The migration must never produce equal or nested roots; if the derived pair would violate validation, fall back to defaults for the conflicting root and surface a warning.

Judged by: migration tests for a docs-located folder, a scratch-located folder, and a conflicting case; visibility re-check test showing both flags refreshed on open; existing projects export without manual reconfiguration.

## File boundaries

Files to create:

- `grill-room/server/project-export-migration.test.ts`

Files to edit:

- `grill-room/server/db/schema.ts`
- `grill-room/server/db/migrations.ts`
- `grill-room/server/projects.ts`
- `grill-room/actions/get-project.ts`
- `grill-room/actions/list-projects.ts`

Existing files it builds on:

- `grill-room/server/git.ts:82`

## Codebase facts

- seedVisibility classifies exactly one folder against git check-ignore and returns one tracked/ignored flag. (`grill-room/server/projects.ts:201-207`)
- projects.visibility is a single column, not one flag per root. (`grill-room/server/db/schema.ts:91`)
- get-project returns the stored project row unchanged, with no migration or visibility re-check step. (`grill-room/actions/get-project.ts:12-21`)
- list-projects returns listProjects() directly, with no migration or visibility re-check step. (`grill-room/actions/list-projects.ts:6-11`)
- Migrations are append-only, so a schema change here is a new ALTER TABLE entry rather than an edit to a shipped one. (`grill-room/server/db/migrations.ts:6-33`)

## Builds on

- Ticket 01: the durableExportFolder and workingExportFolder fields, and the equal-or-nested-roots refusal in project validation, to migrate an existing project's single exportFolder into — ticket 01 adds `durableExportFolder and workingExportFolder fields with an equal/nested-roots refusal in validate()` to `grill-room/server/projects.ts` — check: `grep -n "durableExportFolder" grill-room/server/projects.ts`

## Proved by

Test: `grill-room/server/project-export-migration.test.ts`

```bash
cd grill-room && pnpm vitest run server/project-export-migration.test.ts
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

Otherwise run `git push -u origin HEAD`, then `gh pr create --draft` against `main`, titled `<bead id>: Migrate existing projects to two roots and re-check visibility`, with a body giving the ticket path, the files changed, the exact verification output, and anything this brief left ambiguous. Never merge, and never mark it ready — the reviewer does that once it approves.

## Report, then stop

Report:

- worktree path and branch;
- the PR URL, or "push pending: gh account" with your commit hash;
- commits and files changed;
- the exact output of `just check`;
- anything ambiguous, and anything this brief was missing.

A separate reviewer reviews the work before any merge.

Then stop. Do no further work of any kind.
