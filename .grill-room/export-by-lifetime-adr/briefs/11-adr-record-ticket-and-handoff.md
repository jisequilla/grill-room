# Brief 11: Generate the final 'record ADRs' ticket and the HANDOFF convention section

You are implementing ticket 11 of "Export by lifetime + ADR drafts". You work only inside the git worktree you were started in.

## Step 0: confirm your base

Your worktree was created from `origin/main`. Before anything else, confirm that the existing files this ticket builds on, named under File boundaries, are present. If any is missing, stop and report; do not recreate them.

The bundle is committed in this repository, so your worktree has it. Read the spec at `.grill-room/export-by-lifetime-adr/spec.md` and your ticket at `.grill-room/export-by-lifetime-adr/issues/11-adr-record-ticket-and-handoff.md`, relative to the repository root in your worktree.

## The ticket

Blocked by: 09, 10 (merged before this brief was delegated)

### 11 Generate the final 'record ADRs' ticket and the HANDOFF convention section

When at least one ADR-worthy decision exists, export generates one issue sequenced last that records the ADRs. Its body is self-contained: the list of suggestion files, the detected convention (folder, numbering pattern, template, next-free-number hint) phrased as overridable hints, the Amends targets, and a done condition that every listed suggestion has a corresponding ADR in the repo folder. HANDOFF gains a section restating the convention hint, or stating that no convention was found and placement is the repo owner's call, and states that this ticket must close before the working folder is deleted.

Judged by: tests that the ticket is generated only when ADR-worthy decisions exist, is sequenced last, contains every listed element; HANDOFF tests for the found and not-found convention cases and the cleanup ordering statement.

## File boundaries

Files to edit:

- `grill-room/server/export-bundle.ts`
- `grill-room/server/handoff.ts`
- `grill-room/actions/handoff.test.ts`
- `grill-room/actions/preview-export.test.ts`

## Codebase facts

- renderHandoffMarkdown's fixed sections (where-things-are, verify, before-delegating, waves, lifecycle, reviewing, recording, tracking, build-record) never mention an ADR convention or a final record-ADRs ticket. (`grill-room/server/handoff.ts:634-665`)
- ExportBundlePlan's ticketsExported/ticketsSkippedReason are derived straight from describeTickets(ticketRows); there is no generated final ticket appended to the exported set. (`grill-room/server/export-bundle.ts:610-624`)

## Builds on

- Ticket 09: the detected decisions-folder convention (numbering pattern, template, next-free-number hint) to state as overridable HANDOFF hints and embed in the generated ticket — ticket 09 adds `numbering pattern, template and next-free-number hint fields on ProjectServerFacts` to `grill-room/server/project-facts.ts` — check: `grep -n "decisionsFolder" grill-room/server/project-facts.ts`
- Ticket 10: the rendered ADR suggestion files under the working root and its manifest, to list in the generated ticket's body and done condition — ticket 10 adds `ADR suggestion files planned into the working root and its manifest` to `grill-room/server/export-bundle.ts` — check: `grep -n "Amends" grill-room/server/export-bundle.ts`

## Proved by

Test: `grill-room/actions/handoff.test.ts`

```bash
cd grill-room && pnpm vitest run actions/handoff.test.ts
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

Otherwise run `git push -u origin HEAD`, then `gh pr create --draft` against `main`, titled `<bead id>: Generate the final 'record ADRs' ticket and the HANDOFF convention section`, with a body giving the ticket path, the files changed, the exact verification output, and anything this brief left ambiguous. Never merge, and never mark it ready — the reviewer does that once it approves.

## Report, then stop

Report:

- worktree path and branch;
- the PR URL, or "push pending: gh account" with your commit hash;
- commits and files changed;
- the exact output of `just check`;
- anything ambiguous, and anything this brief was missing.

A separate reviewer reviews the work before any merge.

Then stop. Do no further work of any kind.
