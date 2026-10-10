# Brief 05: Rules: post-merge nits bead, one-way-door confirmation, evidence cleanup

You are implementing ticket 05 of "Delivery loop: gauntlet stages, PR evidence and mutation testing". You work only inside the git worktree you were started in.

## Step 0: confirm your base

Your worktree was created from `origin/main`. Before anything else, confirm that the existing files this ticket builds on, named under File boundaries, are present. If any is missing, stop and report; do not recreate them.

The bundle is committed in this repository, so your worktree has it. Read the spec at `docs/specs/delivery-loop-gauntlet-stages/spec.md` and your ticket at `.grill-room/delivery-loop-gauntlet-stages/issues/05-worktrees-rules-nit-beads-and-merge-danger.md`, relative to the repository root in your worktree.

## The ticket

Blocked by: 02 (merged before this brief was delegated)

### 05 Rules: post-merge nits bead, one-way-door confirmation, evidence cleanup

Update `.claude/rules/worktrees.md` main-session steps: after merge, file one bead per PR from the workflow's returned non-blocking findings at priority 3, label `pr-nits`, title `PR #N nits: <ticket id>`, each entry formatted as level, file:line, one-line fix, evidence command for should-fix, and 'addressed in round N' where applicable; never before merge and never by a reviewer. Before merge, a one-way door in Merge danger stops for the owner's typed confirmation, like a launch. Add `.scratch/` to `.git/info/exclude` as a documented setup step and delete `.scratch/evidence/<bead>/` when that PR's nits bead closes. Restate that pre-flight, merged-with-main verification and merge stay in the main session and a launch still needs the owner's typed message. Provide a small bead-entry formatting helper (new, under `scripts/`) with a shell test alongside `scripts/test-prune-worktrees.sh` style.

Judged by: the formatter test passes; the rules file reads as a single coherent checklist.

## Open questions on this ticket

The consistency check found that this ticket leaves these questions to the owner. Do not choose an answer yourself: if your prompt does not give you the owner's answer to one, stop and report the question instead of building around it.

- When a UI PR merges with no nits bead to close, what event triggers deleting its scratch evidence folder? ("delete `.scratch/evidence/<bead>/` when that PR's nits bead closes")

## File boundaries

_Grounded at commit `e3dd26f`; the repository has moved since._

Files to create:

- `scripts/format-nit-bead.sh`
- `scripts/test-format-nit-bead.sh`

Files to edit:

- `.claude/rules/worktrees.md`

Existing files it builds on:

- `scripts/test-prune-worktrees.sh:1-30`
- `scripts/test-prune-worktrees.sh:87-110`
- `justfile:152-154`

## Codebase facts

- The main-session section lists merging with gh pr merge --merge --delete-branch, a git pull and re-run of the suite before closing the bead, and just prune-worktrees; it has no step for filing a bead after merge, nor one for a one-way door or evidence cleanup. (`.claude/rules/worktrees.md:79-86`)
- The rules file tells main to merge nothing still a draft and to verify itself; the one-way-door confirmation belongs before the merge line at line 85. (`.claude/rules/worktrees.md:81-85`)
- Line 37 already states that pre-flight, branch-merged verification and merge stay in the main session and that a launch needs the user's typed message. (`.claude/rules/worktrees.md:37`)
- Line 52 lists the PR body contents and line 50 the revert proof; both describe the body that ticket 3 changes, and this ticket's text does not name them, so they need updating here for the file to read as one checklist. (`.claude/rules/worktrees.md:50-52`)
- The review lens section says the reviewer posts a verdict comment and lists what it looks for, with no levels; it is where 'reviewers never write beads' belongs. (`.claude/rules/worktrees.md:63-77`)
- The root .gitignore ignores .worktrees/, .claude/worktrees/ and local/ and has no .scratch/ entry, so .scratch/ appears as untracked until the documented .git/info/exclude step is run. (`.gitignore:9-15`)
- Ticket 2's findings carry level, file, line, claim, evidence command and a note; the bead entry also needs a one-line fix and 'addressed in round N', fields the ticket text does not promise, so the formatter must take claim as the fix line and derive the round from the returned rounds array. (`.claude/workflows/ticket-build-review-loop.js:121-150`)
- The existing shell test builds throwaway repositories, asserts exact expected output with string comparison, prints OK or FAILED and exits 0 or 1; the new test follows that shape. (`scripts/test-prune-worktrees.sh:87-110`)
- The test runs under bash directly via `set -uo pipefail`; no justfile recipe runs it (the only prune recipe is prune-worktrees at lines 153-154), so the proof is `bash scripts/test-format-nit-bead.sh`. (`justfile:152-154`)
- The beads reference gives bd ready, show, update --claim and close; it does not show bd create flags, so the helper prints the entry text and leaves the bd invocation to the rules file. (`AGENTS.md:16-24`)
- Repository rule: Pre-flight, verification on the branch merged with main and the merge stay in the main session, and a launch needs the user's typed message; the edit must restate this, not weaken it. (`.claude/rules/worktrees.md:37`). It requires `.claude/rules/worktrees.md`.

## Builds on

- Ticket 02: the non-blocking findings list returned by the workflow (level, file, line, claim, evidence command per finding, split by level) — ticket 02 adds `should-fix` to `.claude/workflows/ticket-build-review-loop.js` — check: `grep -q 'should-fix' .claude/workflows/ticket-build-review-loop.js`

## Proved by

Test: `scripts/test-format-nit-bead.sh`

```bash
bash scripts/test-format-nit-bead.sh
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

Otherwise run `git push -u origin HEAD`, then `gh pr create --draft` against `main`, titled `<bead id>: Rules: post-merge nits bead, one-way-door confirmation, evidence cleanup`, with a body giving the ticket path, the files changed, the exact verification output, and anything this brief left ambiguous. Never merge, and never mark it ready — the reviewer does that once it approves.

## Report, then stop

Report:

- worktree path and branch;
- the PR URL, or "push pending: gh account" with your commit hash;
- commits and files changed;
- the exact output of `just check`;
- anything ambiguous, and anything this brief was missing.

A separate reviewer reviews the work before any merge.

Then stop. Do no further work of any kind.
