# Brief 03: Builder and fix templates: Summary, Evidence, Merge danger and the patch round trip

You are implementing ticket 03 of "Delivery loop: gauntlet stages, PR evidence and mutation testing". You work only inside the git worktree you were started in.

## Step 0: confirm your base

Your worktree was created from `origin/main`. Before anything else, confirm that the existing files this ticket builds on, named under File boundaries, are present. If any is missing, stop and report; do not recreate them.

The bundle is committed in this repository, so your worktree has it. Read the spec at `docs/specs/delivery-loop-gauntlet-stages/spec.md` and your ticket at `.grill-room/delivery-loop-gauntlet-stages/issues/03-builder-and-fix-templates-pr-evidence.md`, relative to the repository root in your worktree.

## The ticket

Blocked by: none

### 03 Builder and fix templates: Summary, Evidence, Merge danger and the patch round trip

Rewrite the PR body section of `.claude/templates/delegation/builder.md` to require Summary (smallest of diff sketch, call tree, file tree or Mermaid), Evidence (per acceptance line: named test, path:start-end ranges it covers, quoted red run with the change reverted and green run with it) and Merge danger (one-way or two-way door, migration is one-way, blast radius). Replace the temporary-commit-or-file-copy revert rule with the single patch round trip, written out verbatim: diff of source paths against main to a patch, reverse-apply, run the named test, re-apply. State that the quoted red run is sufficient TDD proof. For UI tickets, require before and after screenshots via the playwright-core script into the main checkout's `.scratch/evidence/<bead>/` by absolute path, nothing committed, with the path and regenerating command in the PR body. Update `.claude/templates/delegation/fix.md` with the same revert commands and the fix-round duties: re-quote only Evidence entries whose test or ranges changed, add an entry per new test, add a round line under Merge danger if blast radius changed, include should-fix items when a blocker already forced the round, and allow proposing a mutant as equivalent.

Judged by: templates read end to end with no contradiction to `.claude/rules/worktrees.md`; the revert commands are identical in both files and in ticket 4's reviewer template.

## File boundaries

Files to edit:

- `.claude/templates/delegation/builder.md`
- `.claude/templates/delegation/fix.md`

Existing files it builds on:

- `.claude/rules/worktrees.md:46-54`
- `.claude/templates/delegation/reviewer.md:9-18`

## Codebase facts

- builder.md line 9 holds the revert rule: revert with a temporary commit or a copy of the file, never git stash; the ticket replaces this with the patch round trip. (`.claude/templates/delegation/builder.md:9`)
- The PR body list in builder.md names the bead, files changed, per-acceptance proof, exact verify output and ambiguities, and has no Summary, Evidence or Merge danger section. (`.claude/templates/delegation/builder.md:16-21`)
- builder.md fills {{bead}}, {{ticket}} and {{title}} and names the body file `pr-body-{{bead}}.md`; the screenshot path `.scratch/evidence/<bead>/` can reuse {{bead}}. (`.claude/templates/delegation/builder.md:1-3`)
- fix.md line 19 holds its own revert rule (temporary commit or copy of the file, never git stash), which must become the same patch round trip as builder.md. (`.claude/templates/delegation/fix.md:19`)
- fix.md checks out fix-{{bead}} from origin/{{branch}} after `git fetch origin`, so a diff against main in the fix worktree can use the refreshed origin/main. (`.claude/templates/delegation/fix.md:5-7`)
- fix.md ends by pointing at builder.md for the gh account, blocks, process and port rules, so builder.md rules apply to the fixer. (`.claude/templates/delegation/fix.md:25-27`)
- worktrees.md line 52 lists the PR body as ticket path, files changed, exact verification output and ambiguities, and line 50 describes the revert proof without a mechanism; ticket 5 is the ticket that edits worktrees.md, and it is not a blocker of this ticket, so the new body sections will read ahead of the rules file until it lands. (`.claude/rules/worktrees.md:50-52`)
- worktrees.md line 48 says the subagent runs no git command outside its worktree and never touches main; writing screenshots to the main checkout's .scratch/evidence/ by absolute path is a file write, not a git command, and the template must say so. (`.claude/rules/worktrees.md:48`)
- The playwright-core script is named only in the proposal, which says agent-browser's screenshot command fails here; the cited text gives no script path or invocation, so the ticket must write the regenerating command itself. (`docs/proposals/delivery-loop-gauntlet.md:70`)
- The devDependencies block lists @playwright/test 1.62.1 and no playwright-core entry, so a playwright-core script resolves through @playwright/test's installation. (`grill-room/package.json:53`)
- Markdown templates are not collected by vitest (default include is *.test/spec files, excluded e2e), so this ticket is proved by a grep over its own files that fails today. (`grill-room/vitest.config.ts:32-51`)
- Repository rule: The subagent commits only on its worktree branch, runs no git command outside its worktree, proves each line by reverting and restoring, and opens a draft PR whose body carries the ticket path, files changed and verification output; the new sections must not contradict these. (`.claude/rules/worktrees.md:46-54`).

## Proved by

```bash
grep -q 'Merge danger' .claude/templates/delegation/builder.md && grep -q '\.scratch/evidence/' .claude/templates/delegation/builder.md && grep -q 'equivalent' .claude/templates/delegation/fix.md && grep -q 'Merge danger' .claude/templates/delegation/fix.md
```

## Rules

- Create and edit files only within the file boundaries above. If the ticket cannot be done inside them, stop and report instead of widening them.
- Build test fixtures in the encoding production uses for the same data: when a Codebase fact states how a value is stored or sent, match it, and never encode a value twice (such as JSON.stringify into a JSON column).
- Run git only inside your worktree. Never run git against another checkout, never commit directly on `main`, and never merge anything.
- Commit on your worktree branch as you go.

## Verify

From the repository root in your worktree, this must exit 0:

```bash
just check
```

## Delivery

When verification passes, run `gh auth status`. If the active account is not the one this repository expects, do not switch it: stop after committing and report "push pending: gh account" with your commit hash.

Otherwise run `git push -u origin HEAD`, then `gh pr create --draft` against `main`, titled `<bead id>: Builder and fix templates: Summary, Evidence, Merge danger and the patch round trip`, with a body giving the ticket path, the files changed, the exact verification output, and anything this brief left ambiguous. Never merge, and never mark it ready — the reviewer does that once it approves.

## Report, then stop

Report:

- worktree path and branch;
- the PR URL, or "push pending: gh account" with your commit hash;
- commits and files changed;
- the exact output of `just check`;
- anything ambiguous, and anything this brief was missing.

A separate reviewer reviews the work before any merge.

Then stop. Do no further work of any kind.
