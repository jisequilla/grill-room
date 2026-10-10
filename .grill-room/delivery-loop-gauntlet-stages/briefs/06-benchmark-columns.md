# Brief 06: Extend the benchmark with mutation and evidence columns

You are implementing ticket 06 of "Delivery loop: gauntlet stages, PR evidence and mutation testing". You work only inside the git worktree you were started in.

## Step 0: confirm your base

Your worktree was created from `origin/main`. Before anything else, confirm that the existing files this ticket builds on, named under File boundaries, are present. If any is missing, stop and report; do not recreate them.

The bundle is committed in this repository, so your worktree has it. Read the spec at `docs/specs/delivery-loop-gauntlet-stages/spec.md` and your ticket at `.grill-room/delivery-loop-gauntlet-stages/issues/06-benchmark-columns.md`, relative to the repository root in your worktree.

## The ticket

Blocked by: none

### 06 Extend the benchmark with mutation and evidence columns

Extend `docs/benchmarks/hand-loop-vs-workflow.md` with per-ticket columns: Stryker time per run, score, surviving mutants, findings proved only by tool, nit beads filed, evidence re-run result, and the keep criterion (at least one tool-only survivor, every Evidence pair re-ran, per-ticket cost within $3 to $17). Leave rows for gr-6uc, gr-930 and gr-x6w empty for the pilot to fill.

Judged by: the table renders and the criterion is stated once, unambiguously.

## File boundaries

_Grounded at commit `e3dd26f`; the repository has moved since._

Files to edit:

- `docs/benchmarks/hand-loop-vs-workflow.md`

## Codebase facts

- The benchmark's first table compares one hand-loop PR with two workflow PRs on size, agents, tokens, time, rounds, decisions, interventions and wasted runs; it has no mutation or evidence column. (`docs/benchmarks/hand-loop-vs-workflow.md:12-22`)
- The per-ticket cost table lists $5.67 to $17.13 per ticket arm and $3.06 for gr-c0t.4 on the workflow arm, which is the source of the $3 to $17 per-ticket range in the keep criterion. (`docs/benchmarks/hand-loop-vs-workflow.md:55-60`)
- The time-to-ready table is keyed by ticket with Hand and Workflow columns; a pilot table keyed by ticket can follow the same layout. (`docs/benchmarks/hand-loop-vs-workflow.md:47-51`)
- The file ends with the ngine-monitor section's two-arm score table (lines 132-137) and a closing paragraph; new sections append after line 139. (`docs/benchmarks/hand-loop-vs-workflow.md:126-139`)
- The file names no Stryker, gr-6uc, gr-930 or gr-x6w anywhere in lines 1-139, so the grep proof fails today. (`docs/benchmarks/hand-loop-vs-workflow.md:1-139`)
- Repository rule: A doc-only change still goes through the draft PR with the verification output in its body; the grep proof output is what is quoted. (`.claude/rules/worktrees.md:50-52`).

## Proved by

```bash
grep -q 'Stryker time' docs/benchmarks/hand-loop-vs-workflow.md && grep -q 'nit beads filed' docs/benchmarks/hand-loop-vs-workflow.md && grep -q 'gr-6uc' docs/benchmarks/hand-loop-vs-workflow.md && grep -q 'gr-930' docs/benchmarks/hand-loop-vs-workflow.md && grep -q 'gr-x6w' docs/benchmarks/hand-loop-vs-workflow.md
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

Otherwise run `git push -u origin HEAD`, then `gh pr create --draft` against `main`, titled `<bead id>: Extend the benchmark with mutation and evidence columns`, with a body giving the ticket path, the files changed, the exact verification output, and anything this brief left ambiguous. Never merge, and never mark it ready — the reviewer does that once it approves.

## Report, then stop

Report:

- worktree path and branch;
- the PR URL, or "push pending: gh account" with your commit hash;
- commits and files changed;
- the exact output of `just check`;
- anything ambiguous, and anything this brief was missing.

A separate reviewer reviews the work before any merge.

Then stop. Do no further work of any kind.
