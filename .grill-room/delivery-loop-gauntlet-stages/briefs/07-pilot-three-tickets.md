# Brief 07: Pilot gr-6uc, gr-930 and gr-x6w through the changed loop and record the benchmark

You are implementing ticket 07 of "Delivery loop: gauntlet stages, PR evidence and mutation testing". You work only inside the git worktree you were started in.

## Step 0: confirm your base

Your worktree was created from `origin/main`. Before anything else, confirm that the existing files this ticket builds on, named under File boundaries, are present. If any is missing, stop and report; do not recreate them.

The bundle is committed in this repository, so your worktree has it. Read the spec at `docs/specs/delivery-loop-gauntlet-stages/spec.md` and your ticket at `.grill-room/delivery-loop-gauntlet-stages/issues/07-pilot-three-tickets.md`, relative to the repository root in your worktree.

## The ticket

Blocked by: 01, 02, 03, 04, 05, 06 (merged before this brief was delegated)

### 07 Pilot gr-6uc, gr-930 and gr-x6w through the changed loop and record the benchmark

Run the three test-coverage nit tickets through the changed loop using the templates, workflow and rules from tickets 1 to 5. For each, record in the benchmark from ticket 6: Stryker time per run and score, survivors found, findings the reviewer could only prove with the tool, nit beads filed, whether every Evidence pair re-ran as quoted, and per-ticket cost. Apply the keep criterion and write the verdict in the benchmark.

Judged by: three filled rows, the verdict stated, and any overrun or truncation recorded as data.

## File boundaries

_Grounded at commit `e3dd26f`; the repository has moved since._

Files to edit:

- `docs/benchmarks/hand-loop-vs-workflow.md`
- `docs/delegation-log.md`

Existing files it builds on:

- `.claude/rules/worktrees.md:39-44`
- `.claude/rules/worktrees.md:79-86`
- `docs/proposals/delivery-loop-gauntlet.md:114-122`

## Codebase facts

- The proposal's pilot section says to run three test-coverage tickets, naming gr-6uc, gr-930 and gr-x6w among candidates, and to record subagent tokens, wall time, interventions, rounds and what main-session verification found, plus surviving mutants and nit beads. (`docs/proposals/delivery-loop-gauntlet.md:114-122`)
- The proposal calls gr-6uc, gr-930, gr-6qx, gr-x6w and gr-axy 'PR #N nits' beads; they are follow-up nit tickets filed by hand. (`docs/proposals/delivery-loop-gauntlet.md:48`)
- The rules allow up to three tickets at a time, and the main session runs pre-flight, merged-with-main verification and the merge in every route. (`.claude/rules/worktrees.md:37-44`)
- The delegation log is a table with columns Task, Model, First attempt passed, Escalated and What the prompt was missing, one row per delegated task. (`docs/delegation-log.md:3-6`)
- The benchmark reports cost per ticket in a Hand/Workflow table with `$` amounts, which the pilot rows follow. (`docs/benchmarks/hand-loop-vs-workflow.md:55-60`)
- The verification the main session runs after merge is a git pull on main and a re-run of the suite before closing the bead. (`.claude/rules/worktrees.md:85`)
- Repository rule: A launch needs the user's typed message naming the tickets; the pilot cannot be launched by approval through the question tool. (`.claude/rules/worktrees.md:37`).
- Repository rule: Each bead's close comment records model, first-attempt result, escalation and what the prompt lacked, and docs/delegation-log.md summarizes these as a table, so the three pilot beads need rows there. (`CLAUDE.md:55`). It requires `docs/delegation-log.md`.

## Builds on

- Ticket 01: the test:mutate script and ranges script the loop runs — ticket 01 adds `test:mutate` to `grill-room/package.json` — check: `grep -q 'test:mutate' grill-room/package.json`
- Ticket 02: the workflow with the pre-review mutation step and three-level findings — ticket 02 adds `should-fix` to `.claude/workflows/ticket-build-review-loop.js` — check: `grep -q 'should-fix' .claude/workflows/ticket-build-review-loop.js`
- Ticket 03: builder and fix templates with Evidence, Merge danger and the patch round trip — ticket 03 adds `Merge danger` to `.claude/templates/delegation/builder.md` — check: `grep -q 'Merge danger' .claude/templates/delegation/builder.md`
- Ticket 04: the reviewer template that re-runs evidence and judges survivors — ticket 04 adds `test:mutate` to `.claude/templates/delegation/reviewer.md` — check: `grep -q 'test:mutate' .claude/templates/delegation/reviewer.md`
- Ticket 05: the rules checklist step that files the pr-nits bead after merge — ticket 05 adds `pr-nits` to `.claude/rules/worktrees.md` — check: `grep -q 'pr-nits' .claude/rules/worktrees.md`
- Ticket 06: the benchmark's pilot columns and empty rows for the three beads — ticket 06 adds `Stryker time` to `docs/benchmarks/hand-loop-vs-workflow.md` — check: `grep -q 'Stryker time' docs/benchmarks/hand-loop-vs-workflow.md`

## Proved by

```bash
grep -E 'gr-6uc.*\$[0-9]' docs/benchmarks/hand-loop-vs-workflow.md && grep -E 'gr-930.*\$[0-9]' docs/benchmarks/hand-loop-vs-workflow.md && grep -E 'gr-x6w.*\$[0-9]' docs/benchmarks/hand-loop-vs-workflow.md
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

Otherwise run `git push -u origin HEAD`, then `gh pr create --draft` against `main`, titled `<bead id>: Pilot gr-6uc, gr-930 and gr-x6w through the changed loop and record the benchmark`, with a body giving the ticket path, the files changed, the exact verification output, and anything this brief left ambiguous. Never merge, and never mark it ready — the reviewer does that once it approves.

## Report, then stop

Report:

- worktree path and branch;
- the PR URL, or "push pending: gh account" with your commit hash;
- commits and files changed;
- the exact output of `just check`;
- anything ambiguous, and anything this brief was missing.

A separate reviewer reviews the work before any merge.

Then stop. Do no further work of any kind.
