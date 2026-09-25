# Brief 07: Link issues to the decisions they implement

You are implementing ticket 07 of "Export by lifetime + ADR drafts". You work only inside the git worktree you were started in.

## Step 0: confirm your base

Your worktree was created from `origin/main`. Before anything else, confirm that the existing files this ticket builds on, named under File boundaries, are present. If any is missing, stop and report; do not recreate them.

The bundle is committed in this repository, so your worktree has it. Read the spec at `.grill-room/export-by-lifetime-adr/spec.md` and your ticket at `.grill-room/export-by-lifetime-adr/issues/07-issue-decision-keys.md`, relative to the repository root in your worktree.

## The ticket

Blocked by: 06 (merged before this brief was delegated)

### 07 Link issues to the decisions they implement

Add a list of implemented decision keys to issues, filled by the interviewer at planning time and editable in the UI. At export, validate that every key resolves to a settled decision. Derive the reverse index (decision to issues). Emit a warning for any ADR-worthy decision with no implementing issue; issues with no keys are accepted without warning. Render each issue's decision references in its exported file.

Judged by: tests for key validation, reverse index derivation, warning on an orphan ADR-worthy decision, no warning on a keyless issue, and decision references present in the rendered issue.

## File boundaries

Files to create:

- `grill-room/actions/set-ticket-decisions.ts`
- `grill-room/actions/set-ticket-decisions.test.ts`

Files to edit:

- `grill-room/server/db/schema.ts`
- `grill-room/server/db/migrations.ts`
- `grill-room/server/tickets.ts`
- `grill-room/server/interviewer/schemas.ts`
- `grill-room/actions/break-into-tickets.ts`
- `grill-room/server/export.ts`
- `grill-room/app/components/output/tickets-section.tsx`
- `grill-room/server/tickets.test.ts`

Existing files it builds on:

- `grill-room/actions/set-ticket-blocked-by.ts:1-108`

## Codebase facts

- ProposedTicket, what the interviewer's ticket breakdown carries, has number/slug/title/body/blockedBy only, no decision keys. (`grill-room/server/tickets.ts:15-22`)
- StoredTicket/TicketView carry blockedByJson/blockedBy but no decision-key field. (`grill-room/server/tickets.ts:230-255`)
- describeTickets resolves blockedBy from ids to numbers and has no analogous step for decision keys. (`grill-room/server/tickets.ts:258-279`)
- breakIntoTicketsResultSchema's ticket shape has no decisionKeys array. (`grill-room/server/interviewer/schemas.ts:179-190`)
- break-into-tickets inserts each ticket with blockedByJson only; there is no decision-keys column to fill. (`grill-room/actions/break-into-tickets.ts:162-180`)
- renderTicketFile renders label/title/status/blockedBy/body only, nothing about the decisions a ticket implements. (`grill-room/server/export.ts:400-412`)
- set-ticket-blocked-by is the existing pattern for editing a ticket's relations by number, refusing unknown numbers and self-reference. (`grill-room/actions/set-ticket-blocked-by.ts:14-67`)
- tickets-section.tsx already renders a per-ticket blocked-by control with its own inline error codes, with no equivalent control for decisions. (`grill-room/app/components/output/tickets-section.tsx:44-60`)

## Builds on

- Ticket 06: the adrWorthy flag on DecisionView, so an orphan-ADR-worthy-decision warning can be computed against a ticket's decisionKeys — ticket 06 adds `adrWorthy field on DecisionView` to `grill-room/server/tree.ts` — check: `grep -n "adrWorthy" grill-room/server/tree.ts`

## Proved by

Test: `grill-room/server/tickets.test.ts`

```bash
cd grill-room && pnpm vitest run server/tickets.test.ts
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

Otherwise run `git push -u origin HEAD`, then `gh pr create --draft` against `main`, titled `<bead id>: Link issues to the decisions they implement`, with a body giving the ticket path, the files changed, the exact verification output, and anything this brief left ambiguous. Never merge, and never mark it ready — the reviewer does that once it approves.

## Report, then stop

Report:

- worktree path and branch;
- the PR URL, or "push pending: gh account" with your commit hash;
- commits and files changed;
- the exact output of `just check`;
- anything ambiguous, and anything this brief was missing.

A separate reviewer reviews the work before any merge.

Then stop. Do no further work of any kind.
