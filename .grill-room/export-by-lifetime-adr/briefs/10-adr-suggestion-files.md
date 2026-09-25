# Brief 10: Render one ADR suggestion file per ADR-worthy decision into the working root

You are implementing ticket 10 of "Export by lifetime + ADR drafts". You work only inside the git worktree you were started in.

## Step 0: confirm your base

Your worktree was created from `origin/main`. Before anything else, confirm that the existing files this ticket builds on, named under File boundaries, are present. If any is missing, stop and report; do not recreate them.

The bundle is committed in this repository, so your worktree has it. Read the spec at `.grill-room/export-by-lifetime-adr/spec.md` and your ticket at `.grill-room/export-by-lifetime-adr/issues/10-adr-suggestion-files.md`, relative to the repository root in your worktree.

## The ticket

Blocked by: 07, 08 (merged before this brief was delegated)

### 10 Render one ADR suggestion file per ADR-worthy decision into the working root

Add a suggestions folder under the working root, named to say it holds suggestions, with one file per ADR-worthy decision keyed by decision key. Each file is in Grill Room's own built-in shape regardless of repo convention: Status (Proposed), Context from the question and evidence, Decision from the accepted answer, Alternatives from the unchosen options and any superseded answers, Consequences from the stored field, Tickets from the implementing issues (empty list allowed), and Amends when the decision supersedes a repo decision cited from an existing ADR. Register these files in the working manifest so they are guarded and deleted with the working folder. Grill Room writes nothing into the repo's decisions folder and allocates no numbers.

Judged by: rendering tests for every section, a superseded-answer alternative, an Amends line, an empty Tickets list; a plan test that suggestions sit under the working root and appear in the working manifest only.

## File boundaries

Files to edit:

- `grill-room/server/export.ts`
- `grill-room/server/export-bundle.ts`
- `grill-room/server/export.test.ts`
- `grill-room/actions/preview-export.test.ts`

## Codebase facts

- planExport has no renderer for a per-decision ADR suggestion file; its output is spec, intent, decisions.md and issue files only. (`grill-room/server/export.ts:735-770`)
- ExportBundlePlan's files array and manifest are built from plan.files plus the handoff files only, with no suggestions-folder entries. (`grill-room/server/export-bundle.ts:773-838`)

## Builds on

- Ticket 07: decision keys on issues and the decision-to-issues reverse index, to fill each suggestion's Tickets section (empty list allowed) — ticket 07 adds `decisionKeys per ticket and a decision-to-issues reverse index` to `grill-room/server/tickets.ts` — check: `grep -n "decisionKeys" grill-room/server/tickets.ts`
- Ticket 08: the ADR-worthy/Amends/Consequences data already surfaced for decisions.md, which this suggestion's Context/Decision/Alternatives/Amends/Consequences sections reuse — ticket 08 adds `Amends and Consequences fields rendered from a DecisionView in decisions.md` to `grill-room/server/export.ts` — check: `grep -n "Amends" grill-room/server/export.ts`

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

Otherwise run `git push -u origin HEAD`, then `gh pr create --draft` against `main`, titled `<bead id>: Render one ADR suggestion file per ADR-worthy decision into the working root`, with a body giving the ticket path, the files changed, the exact verification output, and anything this brief left ambiguous. Never merge, and never mark it ready — the reviewer does that once it approves.

## Report, then stop

Report:

- worktree path and branch;
- the PR URL, or "push pending: gh account" with your commit hash;
- commits and files changed;
- the exact output of `just check`;
- anything ambiguous, and anything this brief was missing.

A separate reviewer reviews the work before any merge.

Then stop. Do no further work of any kind.
