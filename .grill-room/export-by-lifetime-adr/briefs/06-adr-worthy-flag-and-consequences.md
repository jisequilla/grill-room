# Brief 06: Add the ADR-worthy flag and consequences to decisions and proposals

You are implementing ticket 06 of "Export by lifetime + ADR drafts". You work only inside the git worktree you were started in.

## Step 0: confirm your base

Your worktree was created from `origin/main`. Before anything else, confirm that the existing files this ticket builds on, named under File boundaries, are present. If any is missing, stop and report; do not recreate them.

The bundle is committed in this repository, so your worktree has it. Read the spec at `.grill-room/export-by-lifetime-adr/spec.md` and your ticket at `.grill-room/export-by-lifetime-adr/issues/06-adr-worthy-flag-and-consequences.md`, relative to the repository root in your worktree.

## The ticket

Blocked by: 03 (merged before this brief was delegated)

### 06 Add the ADR-worthy flag and consequences to decisions and proposals

Add two fields to decisions: an ADR-worthy flag and a user-editable consequences text. Extend the interviewer proposal schema so each proposed decision may carry the flag and consequences; extend the scout's repo decision proposal so it may carry the flag; user-added decisions default to unmarked with no consequences. Add a toggle on settled decisions in the tree UI to flip the flag and an editor for consequences. Persist both through the existing decision storage.

Judged by: schema and validation tests for all three proposal shapes; a test that toggling on a settled decision persists; a test that user-added decisions default unmarked; build green with the interviewer prompt updated to describe the new fields.

## File boundaries

Files to create:

- `grill-room/actions/set-decision-adr-worthy.ts`
- `grill-room/actions/set-decision-adr-worthy.test.ts`

Files to edit:

- `grill-room/server/db/schema.ts`
- `grill-room/server/db/migrations.ts`
- `grill-room/server/interviewer/schemas.ts`
- `grill-room/server/tree.ts`
- `grill-room/actions/request-next-round.ts`
- `grill-room/actions/keep-repo-decision.ts`
- `grill-room/app/components/workspace/decision-detail-sheet.tsx`
- `grill-room/server/interviewer/prompt.ts`
- `grill-room/server/interviewer/schemas.test.ts`

Existing files it builds on:

- `grill-room/actions/add-decision.ts:55-71`

## Codebase facts

- proposedDecision has no adrWorthy or consequences field, so the interviewer cannot propose either today. (`grill-room/server/interviewer/schemas.ts:91-112`)
- scoutProjectResultSchema's proposedDecisions entries carry key/title/statement/source/citation/reason only, with no ADR-worthy flag. (`grill-room/server/interviewer/schemas.ts:256-272`)
- DecisionView, what every read action returns, has no adrWorthy or consequences field. (`grill-room/server/tree.ts:364-393`)
- describeDecisions never reads or derives an adrWorthy or consequences value from a row. (`grill-room/server/tree.ts:451-498`)
- request-next-round inserts proposedDecisions into gr_decisions with no adrWorthy/consequences column set. (`grill-room/actions/request-next-round.ts:429-459`)
- keep-repo-decision inserts a kept repo decision with no adrWorthy column set. (`grill-room/actions/keep-repo-decision.ts:119-143`)
- add-decision inserts a user-added decision with no adrWorthy/consequences value, so once those columns exist it will read as their schema default. (`grill-room/actions/add-decision.ts:55-71`)
- The decision detail sheet renders the current answer, dependencies and history only; it has no ADR-worthy toggle or consequences editor. (`grill-room/app/components/workspace/decision-detail-sheet.tsx:1-211`)
- The propose-round prompt's instructions for proposedDecisions cover key/choices/recommendedChoice/recommendedAnswer/dependsOn/ask only, nothing about ADR-worthiness or consequences. (`grill-room/server/interviewer/prompt.ts:273-293`)
- The scout prompt's proposedDecisions bullet describes key/title/statement/source/citation/reason only, with no ADR-worthy instruction. (`grill-room/server/interviewer/prompt.ts:706-719`)

## Builds on

- Ticket 03: Part 1's two-root export/manifest groundwork landed (and, per the spec, used on a real export) before this Part 2 change begins — ticket 03 adds `durableBundleDir and workingBundleDir on ExportBundlePlan` to `grill-room/server/export-bundle.ts` — check: `grep -nE "durableBundleDir|workingBundleDir" grill-room/server/export-bundle.ts`

## Proved by

Test: `grill-room/actions/set-decision-adr-worthy.test.ts`

```bash
cd grill-room && pnpm vitest run actions/set-decision-adr-worthy.test.ts
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

Otherwise run `git push -u origin HEAD`, then `gh pr create --draft` against `main`, titled `<bead id>: Add the ADR-worthy flag and consequences to decisions and proposals`, with a body giving the ticket path, the files changed, the exact verification output, and anything this brief left ambiguous. Never merge, and never mark it ready — the reviewer does that once it approves.

## Report, then stop

Report:

- worktree path and branch;
- the PR URL, or "push pending: gh account" with your commit hash;
- commits and files changed;
- the exact output of `just check`;
- anything ambiguous, and anything this brief was missing.

A separate reviewer reviews the work before any merge.

Then stop. Do no further work of any kind.
