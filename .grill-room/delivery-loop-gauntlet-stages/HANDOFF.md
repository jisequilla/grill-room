# Handoff: Delivery loop: gauntlet stages, PR evidence and mutation testing

## Problem Statement

Every delivered PR in this repo is reviewed by an adversarial reviewer agent, but the review rests on trust and hand work. The builder claims each acceptance line is covered by a test that fails with the change reverted, yet the PR body does not quote the output, so the reviewer either re-derives it by hand or takes it on faith. Test strength is judged by a reviewer mutating code in scratch folders by hand, which is slow, inconsistent, and the kind of finding the last pilot showed a human reviewer catching only two out of four times. Review findings carry no severity and no command that reproduces them, so a blocking finding and a cosmetic nit look alike. The workflow's reviewer schema already returns nits, but the script drops them at the end of a run, and the operator re-files them by hand as follow-up beads after every merge. Nothing in the PR says whether merging is reversible or what it touches.

## Solution

Every PR carries its own evidence, review proves test strength with a tool, and findings are routed by severity. The PR body gains three sections: a Summary with the smallest sketch of the change, an Evidence section quoting a failing and passing run per acceptance line with the line ranges that test covers, and a Merge danger section naming the door type and blast radius. The reviewer re-runs the evidence with the same commands instead of trusting the quotes. A deterministic step in the saved workflow runs StrykerJS on vitest, scoped to the lines the PR changes, under a fixed cap, before every review round; survivors are handed to the tests lens reviewer, who turns them into findings. A survivor on a line an acceptance entry claims to cover is a blocker; elsewhere it is a nit. Findings carry one of three levels and, for blockers and should-fix items, the command that shows them. Blockers force a fix round, should-fix items ride along into a fix round that is already happening, and everything that did not block is returned by the workflow and filed by the main session as one follow-up bead per merged PR. A one-way door stops the main session for the owner's typed confirmation before merge. Three test-coverage tickets pilot the loop and extend the benchmark so the changes stay only if the tool proved something a human did not, the evidence re-ran, and cost stayed within the known range.

## The original idea, before the interview

Make every delivered PR in this repo carry its own evidence, and make review prove test strength with a tool instead of by hand. This is the first slice of docs/proposals/delivery-loop-gauntlet.md (its changes 2, 3 and 5). The rest of that proposal (the ticket gauntlet, verification inside the workflow, the visual critic, the linter and hotspot report) is out of scope here and gets its own session later.

Three changes, to the delegation templates (.claude/templates/delegation/builder.md, reviewer.md, fix.md), the saved workflow (.claude/workflows/ticket-build-review-loop.js) and .claude/rules/worktrees.md:

1. PR body from Matt Pocock's pr template. Summary: the smallest diff sketch, call tree, file tree or Mermaid diagram of the change. Evidence: for each acceptance line, its named test failing with the change reverted and passing with it, quoted from command output (screenshots for a UI ticket, via the playwright-core script). Merge danger: one-way or two-way door (a migration is one-way) and the blast radius. The reviewer re-runs the evidence rather than trusting it.
2. Diff-scoped mutation testing with StrykerJS on vitest (grill-room has no Stryker today), run during review on the lines the PR changes, never the whole suite, which already times out under machine load. Surviving mutants become findings with file:line, the mutation and the suite result.
3. Review findings routed by severity with evidence. Blocking findings stay in the PR verdict comment, each with severity and the command that shows it. Non-blocking nits, which the workflow's reviewer schema already returns in a nits array but drops at the end of a run, are collected and filed as one follow-up bead per PR after merge. Reviewers never write beads themselves.

Unchanged: pre-flight, verification of the branch merged with main, and the merge all stay in the main session, as worktrees.md says; the two-fix-round cap with the operator deciding; a launch needs the owner's typed message.

Questions this grill must settle:
- Is the mutation result a gate, a report, or a gate only on lines an acceptance line covers? What score, if any?
- Does the existing tests lens run the mutations, or a separate mutation critic?
- TDD: is the red run in Evidence enough, or must the commits show the test before the change?
- Reverting for the red run without bare git stash: how does the builder produce it?
- Nit beads: one per PR or per nit, what priority, filed by the workflow's last step or by the main session after merge?
- What does Stryker cost per PR in time and tokens, and what is the cap?

Pilot: gr-6uc, gr-930 and gr-x6w (three test-coverage nit tickets) through the changed loop, recorded in docs/benchmarks/ with the measures of hand-loop-vs-workflow.md plus: surviving mutants the tool found, findings the reviewer could only prove with the tool, nit beads filed, and whether the evidence re-ran as quoted.

## Where things are

This is the entry point for the orchestrating session that builds this feature. Everything needed to run the tickets is here or linked from here.

Paths below are relative to the repository root (`/Users/jeremiasdeisequilla/repos/personal/poc-grill-me`). The bundle lives in `.grill-room`, which git tracks.

- Spec: `docs/specs/delivery-loop-gauntlet-stages/spec.md`
- Tickets: `.grill-room/delivery-loop-gauntlet-stages/issues/`
- Briefs: `.grill-room/delivery-loop-gauntlet-stages/briefs/`, one per ticket, grounded and ready to paste as a delegation prompt
- Grill Room session: `bb45d68a-ae9e-4134-8578-f98e8dc3fd50`

## Verify command

```bash
just check
```

Run from the repository root: once by the subagent before it hands the ticket back, and again by you before you merge it in.

## Before delegating the first ticket

Worktree agents start from `origin/main`, so they see the bundle only once it is committed and pushed. Grill Room never commits in this repository; do it yourself, once, before delegating:

```bash
git add docs/specs/delivery-loop-gauntlet-stages .grill-room/delivery-loop-gauntlet-stages
git commit -m "Add the Delivery loop: gauntlet stages, PR evidence and mutation testing handoff bundle"
git push
```

Commit and push again whenever the bundle is re-exported.

## Execution plan

- Longest chain: 4 build tickets, built one after another: 01 → 02 → 04 → 07.
- Wave widths, in build tickets: 3, 1, 2, 1 (wave 1 first).
- Run at most 3 tickets at a time, even when a wave is wider. The repository sets this cap: `.claude/rules/worktrees.md:44`. Every ticket in flight draws on the same subscription's rate limit, and a rate-limited failure reads like a failed ticket; each one's reports also need your attention before it can merge.

## Waves

Tickets in one wave do not block each other and may run in parallel, each in its own worktree; start with at most 3 at a time. Start a wave only once every ticket of the previous wave is merged and verified.

### Wave 1

- **01 Add StrykerJS on vitest to grill-room with a diff-scoped test:mutate script**
  - Ticket: `.grill-room/delivery-loop-gauntlet-stages/issues/01-stryker-setup-and-mutate-script.md`
  - Brief: [`.grill-room/delivery-loop-gauntlet-stages/briefs/01-stryker-setup-and-mutate-script.md`](briefs/01-stryker-setup-and-mutate-script.md)
- **03 Builder and fix templates: Summary, Evidence, Merge danger and the patch round trip**
  - Ticket: `.grill-room/delivery-loop-gauntlet-stages/issues/03-builder-and-fix-templates-pr-evidence.md`
  - Brief: [`.grill-room/delivery-loop-gauntlet-stages/briefs/03-builder-and-fix-templates-pr-evidence.md`](briefs/03-builder-and-fix-templates-pr-evidence.md)
- **06 Extend the benchmark with mutation and evidence columns**
  - Ticket: `.grill-room/delivery-loop-gauntlet-stages/issues/06-benchmark-columns.md`
  - Brief: [`.grill-room/delivery-loop-gauntlet-stages/briefs/06-benchmark-columns.md`](briefs/06-benchmark-columns.md)

### Wave 2

- **02 Run Stryker before each review round in the workflow and reshape the REVIEW schema** (blocked by 01)
  - Ticket: `.grill-room/delivery-loop-gauntlet-stages/issues/02-workflow-mutation-step-and-review-schema.md`
  - Brief: [`.grill-room/delivery-loop-gauntlet-stages/briefs/02-workflow-mutation-step-and-review-schema.md`](briefs/02-workflow-mutation-step-and-review-schema.md)

### Wave 3

- **04 Reviewer template: re-run evidence, judge survivors, three-level findings with evidence commands** (blocked by 02, 03)
  - Ticket: `.grill-room/delivery-loop-gauntlet-stages/issues/04-reviewer-template-evidence-rerun-and-survivors.md`
  - Brief: [`.grill-room/delivery-loop-gauntlet-stages/briefs/04-reviewer-template-evidence-rerun-and-survivors.md`](briefs/04-reviewer-template-evidence-rerun-and-survivors.md)
- **05 Rules: post-merge nits bead, one-way-door confirmation, evidence cleanup** (blocked by 02)
  - Ticket: `.grill-room/delivery-loop-gauntlet-stages/issues/05-worktrees-rules-nit-beads-and-merge-danger.md`
  - Brief: [`.grill-room/delivery-loop-gauntlet-stages/briefs/05-worktrees-rules-nit-beads-and-merge-danger.md`](briefs/05-worktrees-rules-nit-beads-and-merge-danger.md)

### Wave 4

- **07 Pilot gr-6uc, gr-930 and gr-x6w through the changed loop and record the benchmark** (blocked by 01, 02, 03, 04, 05, 06)
  - Ticket: `.grill-room/delivery-loop-gauntlet-stages/issues/07-pilot-three-tickets.md`
  - Brief: [`.grill-room/delivery-loop-gauntlet-stages/briefs/07-pilot-three-tickets.md`](briefs/07-pilot-three-tickets.md)

## Questions the spec and tickets leave open

The consistency check found these statements, which leave a builder to decide something the owner never decided. Before delegating a ticket a question quotes, get the owner's answer and put it in the delegation prompt; the question is also in that ticket's brief. Answer the rest before calling the feature done.

- For a test-only PR such as the three pilot tickets, where the source diff against main is empty and the test cannot fail when reverted, what does the Evidence entry quote as its red run? (spec, Implementation Decisions: "write the diff of source files against main to a patch, reverse-apply it, run the named test, re-apply")
- Who compares survivor positions against the Evidence ranges: the deterministic workflow step, which would need the PR body's ranges as input, or the tests lens reviewer reading the PR body by hand? (ticket 04: "A survivor on a line inside an Evidence range defaults to blocker")
- Stryker's timeoutMS is a per-mutant test-run limit, not a run-wide wall clock, so what per-mutant timeout should the config set given the ten-minute wall-clock cap is enforced by the script? (ticket 01: "timeout from the cap")
- Reviewer templates arrive as an anonymous list through args, so how does the workflow identify which one is the tests lens: a named arg, a filename convention, or a placeholder present in the template? (ticket 02: "into the tests lens reviewer template as filled input")
- When a merged PR has no should-fix or nit findings at all, is an empty bead still filed or is the step skipped? (spec, User Stories: "I want to file one follow-up bead per merged PR")
- When a UI PR merges with no nits bead to close, what event triggers deleting its scratch evidence folder? (ticket 05: "delete `.scratch/evidence/<bead>/` when that PR's nits bead closes")
- Besides a migration, which other kinds of change count as a one-way door, for example data deletion, an external call with side effects, or a published package version? (spec, Implementation Decisions: "a migration is one-way")
- What level does the reviewer assign when the quoted green run does not reproduce, meaning the named test fails with the change applied? (spec, Implementation Decisions: "A test that passes with the change reverted is a blocker; a stale quote with a correct test is a nit.")
- When a regenerated screenshot differs from the one the builder produced, what level is the finding and what tolerance, if any, counts as a match? (spec, Implementation Decisions: "The reviewer re-runs every Evidence pair with the same two commands and regenerates screenshots.")
- How does the pilot determine that a survivor is one a human reviewer would not have found: a reviewer run without the survivor list on the same PR, a comparison with the earlier hand findings for that ticket, or the reviewer's own statement? (spec, Testing Decisions: "the keep criterion of at least one tool-only survivor")
- The workflow script lives at the repo root outside grill-room's vitest setup, so which package and test command runs the tests for the schema and routing code, and is that logic extracted into an importable module to make it testable? (ticket 02: "vitest tests for the schema validation and the routing filter")

## Delegation lifecycle

Every ticket runs in its own worktree (Agent tool, `isolation: "worktree"`) and reaches `main` only through a pull request you have reviewed and verified. Worktrees are created from `origin/main`, not from local `main`, so work merged only locally is invisible to the next worktree.

Where this lifecycle differs from the repository's own rules, the repository's rule wins: `.claude/rules/worktrees.md`.

### Before launching a ticket

- Local `main` holds nothing unpushed (`git status`, `git log origin/main..main`). Push it first if it does, so the worktree's base includes it.
- The briefs are grounded and current: **File boundaries** and **Codebase facts** are already filled in from the code. Check them against the ticket before delegating, rather than filling them by hand. Then paste the whole brief as the delegation prompt.
- Pre-flight the ticket before launching it, following the repository's own procedure at `.claude/rules/worktrees.md:43`. Launch the ticket only when that procedure clears it.

### The subagent

- Commits only on its worktree branch; runs no git command outside its worktree and never touches `main`.
- Runs `just check`; it must pass.
- Checks `gh auth status`. If the active account is not the one this repository expects, it stops before pushing and reports "push pending: gh account" with its commit hash.
- Otherwise pushes its branch (`git push -u origin HEAD`) and opens a **draft** pull request against `main` with `gh pr create --draft`. The title names the ticket; the body carries the ticket path, files changed, the exact verification output, and anything the brief left ambiguous.
- Reports the PR, then stops. It never merges, and a draft is never merged by anyone.

### You, the main session

1. Read the PR diff (`gh pr diff <n>`) against the brief's file boundaries.
2. Send the ticket to a second, fresh-context reviewer (see "Reviewing a ticket" below) and wait for its verdict comment on the pull request.
3. Once the reviewer approves and marks the pull request ready, re-run `just check` yourself in the worktree, plus any browser check the ticket calls for. A subagent's report is a claim, not evidence.
4. If it fails, run `gh pr ready --undo <n>` to put the pull request back in draft, then send the failure back to the same agent on its branch; the fix lands as a new commit on the same PR, and goes back to the reviewer.
5. Merge only a ready, approved pull request whose re-verification in step 3 has passed: `gh pr merge <n> --merge --delete-branch`. Never merge a draft.
6. `git pull` on local `main` and re-run `just check` on the merged result.
7. Close the ticket's bead with a comment naming the PR.
8. Prune merged worktrees with the repository's command: `just prune-worktrees` (`.claude/rules/worktrees.md:86`).

## Reviewing a ticket

Every ticket is reviewed by a second, fresh-context agent before it can be merged.

**The repository's review rule.** `.claude/rules/worktrees.md:75` sets how this repository reviews tickets; where it differs from this section, it wins.

**Two lenses.** These tickets get two reviewers instead of one, each with fresh context and its own lens, because the repository's review rule says so for them:

- **02 Run Stryker before each review round in the workflow and reshape the REVIEW schema** (`.claude/rules/worktrees.md:75`)
- **03 Builder and fix templates: Summary, Evidence, Merge danger and the patch round trip** (`.claude/rules/worktrees.md:75`)
- **04 Reviewer template: re-run evidence, judge survivors, three-level findings with evidence commands** (`.claude/rules/worktrees.md:75`)

Each of the two reviewers takes one lens:

- **Correctness lens.** Tries to break the change against the spec and the ticket: every example the ticket gives, the seams with the tickets it builds on, files changed outside its boundaries, and claims the diff does not support.
- **Tests lens.** Checks that every acceptance criterion has a test that fails with its change reverted, that every example the ticket gives is tested, and, when the change touches both a model prompt and the check that enforces it, that a seam test shows every answer the prompt describes passes the check.

For these tickets, neither reviewer runs `gh pr ready`: you mark the pull request ready once both approve, and merge only then.

**Inputs.** The reviewer gets the spec, the ticket, its delegation brief and the diff — never the builder's report.

**What to try to break.** Unmet acceptance criteria, changes outside the file boundaries, untested edge cases, seams with the tickets this one builds on, and claims the diff does not support.

**Verdict.** It posts its verdict as a pull request comment, starting "Review verdict: approved" or "Review verdict: changes requested" with each finding, then runs `gh pr ready <n>` on approval.

**Changes requested.** They go back to the builder on the same branch, and the same reviewer reviews again. After two rejected rounds, the operator decides.

The reviewer changes no code and never merges.

## What to record per ticket

When a ticket closes, record:

- the model the subagent ran on;
- whether its first attempt passed verification;
- whether it escalated to a stronger model;
- what the delegation prompt was missing, when an attempt failed.

An escalation is the most useful data point: it shows where the brief, not the model, was the weak link.

## Tracking with beads

Create one bead per ticket. Claim a bead before delegating its ticket, and close it only after you have verified and merged the change, naming the merge in the close comment. Recover state with `bd ready` and `git log`, never from memory.

The repository's declared tracker commands:

- `ready`: `bd ready`
- `claim`: `bd update {id} --claim`
- `close`: `bd close {id}`

## Build records

Log each ticket's outcome in Grill Room once it closes. Run this command from the Grill Room app folder (it reaches its running dev server), once per ticket: set `<ticket-number>` to the ticket's number and fill in the other placeholders.

```bash
pnpm action set-build-record --sessionId bb45d68a-ae9e-4134-8578-f98e8dc3fd50 --ticketNumber <ticket-number> --model <model> --firstAttemptPassed <true|false> --escalated <true|false> --promptMissing "<what the brief was missing>" --ticketStatus done
```
