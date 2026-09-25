# Brief 09: Detect the repo's ADR convention in the scout

You are implementing ticket 09 of "Export by lifetime + ADR drafts". You work only inside the git worktree you were started in.

## Step 0: confirm your base

Your worktree was created from `origin/main`. Before anything else, confirm that the existing files this ticket builds on, named under File boundaries, are present. If any is missing, stop and report; do not recreate them.

The bundle is committed in this repository, so your worktree has it. Read the spec at `.grill-room/export-by-lifetime-adr/spec.md` and your ticket at `.grill-room/export-by-lifetime-adr/issues/09-adr-convention-detection.md`, relative to the repository root in your worktree.

## The ticket

Blocked by: none

### 09 Detect the repo's ADR convention in the scout

Extend scout fact detection beyond folder existence. When a decisions folder is found, infer the numbering pattern from existing filenames, the template from an existing file's headings, and a next-free-number hint. Store these as server facts alongside the folder. When nothing is found, record that explicitly. Never create a folder or file in the repo.

Judged by: fixture-based tests for a prefixed numeric convention, a plain numeric convention, a template with headings, and a repo with no decisions folder; a test that detection performs no writes.

## File boundaries

Files to edit:

- `grill-room/server/project-facts.ts`
- `grill-room/server/scout-report.ts`
- `grill-room/server/project-facts.test.ts`

## Codebase facts

- ProjectServerFacts.decisionsFolder is a bare path-or-null; the interface has no numbering-pattern, template or next-free-number fields. (`grill-room/server/project-facts.ts:33-53`)
- findDecisionsFolder only checks a fixed candidate list for directory existence; it never reads the folder's own filenames. (`grill-room/server/project-facts.ts:61-84`)
- collectProjectFacts never lists the decisions folder's entries or reads any file inside it. (`grill-room/server/project-facts.ts:146-199`)
- scout-report.ts's factsSchema is declared to satisfy z.ZodType<ProjectServerFacts>, so it must be extended in lockstep with any new field added to that interface. (`grill-room/server/scout-report.ts:40-58`)

## Proved by

Test: `grill-room/server/project-facts.test.ts`

```bash
cd grill-room && pnpm vitest run server/project-facts.test.ts
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

Otherwise run `git push -u origin HEAD`, then `gh pr create --draft` against `main`, titled `<bead id>: Detect the repo's ADR convention in the scout`, with a body giving the ticket path, the files changed, the exact verification output, and anything this brief left ambiguous. Never merge, and never mark it ready — the reviewer does that once it approves.

## Report, then stop

Report:

- worktree path and branch;
- the PR URL, or "push pending: gh account" with your commit hash;
- commits and files changed;
- the exact output of `just check`;
- anything ambiguous, and anything this brief was missing.

A separate reviewer reviews the work before any merge.

Then stop. Do no further work of any kind.
