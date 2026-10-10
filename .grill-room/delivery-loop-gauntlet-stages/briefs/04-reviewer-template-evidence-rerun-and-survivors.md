# Brief 04: Reviewer template: re-run evidence, judge survivors, three-level findings with evidence commands

You are implementing ticket 04 of "Delivery loop: gauntlet stages, PR evidence and mutation testing". You work only inside the git worktree you were started in.

## Step 0: confirm your base

Your worktree was created from `origin/main`. Before anything else, confirm that the existing files this ticket builds on, named under File boundaries, are present. If any is missing, stop and report; do not recreate them.

The bundle is committed in this repository, so your worktree has it. Read the spec at `docs/specs/delivery-loop-gauntlet-stages/spec.md` and your ticket at `.grill-room/delivery-loop-gauntlet-stages/issues/04-reviewer-template-evidence-rerun-and-survivors.md`, relative to the repository root in your worktree.

## The ticket

Blocked by: 02, 03 (merged before this brief was delegated)

### 04 Reviewer template: re-run evidence, judge survivors, three-level findings with evidence commands

Rewrite `.claude/templates/delegation/reviewer.md`: the reviewer re-runs every quoted Evidence pair with the same patch round trip commands as ticket 3 and regenerates UI screenshots from the named command. A test that passes with the change reverted is a blocker; a stale quote with a correct test is a nit about the PR body. The tests lens takes the survivor list as filled input and documents the `test:mutate` command for a hand loop. A survivor on a line inside an Evidence range defaults to blocker, elsewhere to nit; a downgrade requires the mutant quoted and the reason no test could kill it; the reviewer owns equivalent-mutant calls in the verdict. Findings use the three levels; every blocker and should-fix carries the command that shows it; every nit carries file:line and a one-line fix. The reviewer never writes beads. The verdict output must match the schema from ticket 2.

Judged by: a dry run of the template against a sample PR produces findings that validate against the ticket 2 schema; wording stays consistent with worktrees.md.

## Open questions on this ticket

The consistency check found that this ticket leaves these questions to the owner. Do not choose an answer yourself: if your prompt does not give you the owner's answer to one, stop and report the question instead of building around it.

- Who compares survivor positions against the Evidence ranges: the deterministic workflow step, which would need the PR body's ranges as input, or the tests lens reviewer reading the PR body by hand? ("A survivor on a line inside an Evidence range defaults to blocker")

## File boundaries

Files to edit:

- `.claude/templates/delegation/reviewer.md`

Existing files it builds on:

- `.claude/rules/worktrees.md:63-77`
- `.claude/workflows/ticket-build-review-loop.js:46-55`

## Codebase facts

- reviewer.md fills {{pr}}, {{lens}}, {{ticket}}, {{prior_round}} and {{branch}}; a survivor-list placeholder is a new fill key that ticket 2's script must supply. (`.claude/templates/delegation/reviewer.md:1-18`)
- The acceptance-proof bullet tells the reviewer to revert only the change a line covers, confirm the test fails, then restore it, with no named mechanism; the ticket replaces it with the patch round trip from ticket 3. (`.claude/templates/delegation/reviewer.md:12`)
- The scratch-folder paragraph tells reviewers to put mutation copies and scripts in a folder named for the PR, round and lens; test:mutate output must follow that folder rule or the ticket must say where it writes. (`.claude/templates/delegation/reviewer.md:18`)
- The verdict section says label nits non-blocking and end with `VERDICT: approved` or `VERDICT: changes-requested` followed by numbered blocking findings, which has no levels or evidence commands today. (`.claude/templates/delegation/reviewer.md:22-26`)
- On approval the template tells the reviewer to run gh pr ready, while the workflow appends a note telling one-of-several lenses not to; both stay. (`.claude/workflows/ticket-build-review-loop.js:75-76`)
- REVIEW today accepts verdict approved|changes-requested|blocked and findings as strings; the template's output must match ticket 2's replacement shape, which is not yet in the file. (`.claude/workflows/ticket-build-review-loop.js:46-55`)
- worktrees.md line 75 gives the correctness and tests lenses; the survivor list goes to the tests lens only. (`.claude/rules/worktrees.md:75`)
- Repository rule: The reviewer changes no code, posts its verdict with gh pr comment, runs gh pr ready on approval, and a PR touching a check, schema or prompt gets two lenses; the rewritten template must keep these. (`.claude/rules/worktrees.md:63-77`).

## Builds on

- Ticket 02: the three-level findings schema (level blocker|should-fix|nit, file, line, claim, evidence command, equivalent-mutant note) and the survivor placeholder name the script fills — ticket 02 adds `should-fix` to `.claude/workflows/ticket-build-review-loop.js` — check: `grep -q 'should-fix' .claude/workflows/ticket-build-review-loop.js`
- Ticket 03: the patch round trip commands, copied verbatim into the reviewer template — ticket 03 adds `Merge danger` to `.claude/templates/delegation/builder.md` — check: `grep -q 'Merge danger' .claude/templates/delegation/builder.md`

## Proved by

```bash
grep -q 'should-fix' .claude/templates/delegation/reviewer.md && grep -q 'test:mutate' .claude/templates/delegation/reviewer.md && grep -q 'equivalent' .claude/templates/delegation/reviewer.md && grep -q 'blocker' .claude/templates/delegation/reviewer.md
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

Otherwise run `git push -u origin HEAD`, then `gh pr create --draft` against `main`, titled `<bead id>: Reviewer template: re-run evidence, judge survivors, three-level findings with evidence commands`, with a body giving the ticket path, the files changed, the exact verification output, and anything this brief left ambiguous. Never merge, and never mark it ready — the reviewer does that once it approves.

## Report, then stop

Report:

- worktree path and branch;
- the PR URL, or "push pending: gh account" with your commit hash;
- commits and files changed;
- the exact output of `just check`;
- anything ambiguous, and anything this brief was missing.

A separate reviewer reviews the work before any merge.

Then stop. Do no further work of any kind.
