# Brief 08: Render ADR-worthy mark, Amends target and Consequences in decisions.md

You are implementing ticket 08 of "Export by lifetime + ADR drafts". You work only inside the git worktree you were started in.

## Step 0: confirm your base

Your worktree was created from `origin/main`. Before anything else, confirm that the existing files this ticket builds on, named under File boundaries, are present. If any is missing, stop and report; do not recreate them.

The bundle is committed in this repository, so your worktree has it. Read the spec at `.grill-room/export-by-lifetime-adr/spec.md` and your ticket at `.grill-room/export-by-lifetime-adr/issues/08-decisions-md-adr-marks.md`, relative to the repository root in your worktree.

## The ticket

Blocked by: 06 (merged before this brief was delegated)

### 08 Render ADR-worthy mark, Amends target and Consequences in decisions.md

Extend decisions.md rendering so each ADR-worthy entry is marked, shows its Amends target when its decision supersedes a repo decision cited from an existing ADR, and renders its consequences. Carry no path to any suggestion file or repo ADR. Non-ADR-worthy entries render as today so decisions.md remains the full record. Keep the supersession parser working on the new format.

Judged by: rendering tests for a marked entry with and without Amends, an entry with consequences, an unmarked entry unchanged, and no file paths present; supersession parser round-trip still passes.

## File boundaries

Files to edit:

- `grill-room/server/export.ts`
- `grill-room/server/export.test.ts`

Existing files it builds on:

- `grill-room/server/decisions-file.ts:37-62`

## Codebase facts

- renderEntry writes Decision/Why/Origin/Depends on/Source/Supersedes fields only; there is no ADR-worthy mark, Amends line, or Consequences field. (`grill-room/server/export.ts:523-568`)
- export.test.ts's decision() fixture builds a full DecisionView with a fixed set of overridable fields, none of which is adrWorthy or consequences. (`grill-room/server/export.test.ts:18-44`)
- RepoOrigin, the data a Source/Supersedes line is rendered from, carries source/citation/statement/scoutReportId — the same shape an Amends line would read. (`grill-room/server/tree.ts:344-350`)
- supersededEntries parses decisions.md entries by their <a id>, ### title, Source: and Supersedes: lines, so a new field added elsewhere in the entry must not disturb that shape. (`grill-room/server/decisions-file.ts:37-62`)

## Builds on

- Ticket 06: the adrWorthy and consequences fields on DecisionView to render as the mark, Amends target and Consequences text — ticket 06 adds `adrWorthy and consequences fields on DecisionView and describeDecisions` to `grill-room/server/tree.ts` — check: `grep -n "adrWorthy" grill-room/server/tree.ts`

## Proved by

Test: `grill-room/server/export.test.ts`

```bash
cd grill-room && pnpm vitest run server/export.test.ts
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

Otherwise run `git push -u origin HEAD`, then `gh pr create --draft` against `main`, titled `<bead id>: Render ADR-worthy mark, Amends target and Consequences in decisions.md`, with a body giving the ticket path, the files changed, the exact verification output, and anything this brief left ambiguous. Never merge, and never mark it ready — the reviewer does that once it approves.

## Report, then stop

Report:

- worktree path and branch;
- the PR URL, or "push pending: gh account" with your commit hash;
- commits and files changed;
- the exact output of `just check`;
- anything ambiguous, and anything this brief was missing.

A separate reviewer reviews the work before any merge.

Then stop. Do no further work of any kind.
