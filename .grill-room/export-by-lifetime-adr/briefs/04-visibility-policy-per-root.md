# Brief 04: Refuse export on an ignored durable root, warn on an ignored working root

You are implementing ticket 04 of "Export by lifetime + ADR drafts". You work only inside the git worktree you were started in.

## Step 0: confirm your base

Your worktree was created from `origin/main`. Before anything else, confirm that the existing files this ticket builds on, named under File boundaries, are present. If any is missing, stop and report; do not recreate them.

The bundle is committed in this repository, so your worktree has it. Read the spec at `.grill-room/export-by-lifetime-adr/spec.md` and your ticket at `.grill-room/export-by-lifetime-adr/issues/04-visibility-policy-per-root.md`, relative to the repository root in your worktree.

## The ticket

Blocked by: 03 (merged before this brief was delegated)

### 04 Refuse export on an ignored durable root, warn on an ignored working root

Extend the export gate and post-export visibility classification to two roots. Export refuses with a clear message when the durable root is gitignored. Export proceeds with a warning when the working root is gitignored. Post-export classification and its warnings cover paths under both roots.

Judged by: gate tests for ignored durable root (refused), ignored working root (warned, export written), both tracked (no warning); classification tests over a mixed set of paths under both roots.

## File boundaries

Files to edit:

- `grill-room/server/export-bundle.ts`
- `grill-room/server/visibility.ts`
- `grill-room/actions/export-session.ts`
- `grill-room/actions/get-export-visibility.ts`
- `grill-room/server/visibility.test.ts`
- `grill-room/actions/export-session.test.ts`

Existing files it builds on:

- `grill-room/server/check-ignore.ts:63-93`

## Codebase facts

- getExportGate only ever returns handoff-missing or handoff-stale; there is no reason for an ignored durable root. (`grill-room/server/handoff.ts:1189-1214`)
- classifyVisibility and buildVisibilityReport take one root and classify every path against it, with no notion of a second root. (`grill-room/server/visibility.ts:88-91`)
- buildVisibilityWarnings' mismatchWarning compares hasIgnored/hasTracked against a single visibility value, not one per root. (`grill-room/server/visibility.ts:193-206`)
- export-session refuses only on plan.exportBlockedReason with the two handoff-gate codes; there is no ignored-root refusal path. (`grill-room/actions/export-session.ts:26-35`)
- get-export-visibility classifies plan.files, a single flat list, against one project.visibility flag. (`grill-room/actions/get-export-visibility.ts:18-26`)

## Builds on

- Ticket 03: separate durable and working bundle directories on the export plan to gate ignored/tracked status against independently — ticket 03 adds `a durable-root bundle directory distinct from the working-root bundle directory on ExportBundlePlan` to `grill-room/server/export-bundle.ts` — check: `grep -nE "durableBundleDir|workingBundleDir" grill-room/server/export-bundle.ts`

## Proved by

Test: `grill-room/server/visibility.test.ts`

```bash
cd grill-room && pnpm vitest run server/visibility.test.ts
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

Otherwise run `git push -u origin HEAD`, then `gh pr create --draft` against `main`, titled `<bead id>: Refuse export on an ignored durable root, warn on an ignored working root`, with a body giving the ticket path, the files changed, the exact verification output, and anything this brief left ambiguous. Never merge, and never mark it ready — the reviewer does that once it approves.

## Report, then stop

Report:

- worktree path and branch;
- the PR URL, or "push pending: gh account" with your commit hash;
- commits and files changed;
- the exact output of `just check`;
- anything ambiguous, and anything this brief was missing.

A separate reviewer reviews the work before any merge.

Then stop. Do no further work of any kind.
