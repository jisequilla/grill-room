# Intent: Delivery loop: gauntlet stages, PR evidence and mutation testing

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

## Readiness before the interview

Not judged for this version of the idea.

## Project state

- **Built:** Rules file already defines the delivery loop: draft PR, adversarial reviewer, two lenses for checks/schemas/prompts, two fix rounds, main session verifies and merges. (.claude/rules/worktrees.md:63-86)
- **Partial:** Builder template already requires a per-acceptance revert proof and a PR body listing bead, files, proof and verify output, but has no Summary / Evidence / Merge danger structure, no quoted fail-then-pass output, no screenshots. (.claude/templates/delegation/builder.md:9, .claude/templates/delegation/builder.md:16-21)
- **Built:** The revert-without-git-stash rule already exists, using a temporary commit or file copy, in both builder and fix templates. (.claude/templates/delegation/builder.md:9, .claude/templates/delegation/fix.md:19)
- **Partial:** Reviewer template re-runs the revert check by hand per acceptance line and mentions mutation copies in scratch folders, but has no Stryker or diff-scoped mutation step and does not re-run PR-body evidence. (.claude/templates/delegation/reviewer.md:12, .claude/templates/delegation/reviewer.md:18)
- **Gap:** grill-room has no StrykerJS dependency or config; its test script is plain vitest --run and vitest ^4.1.5 is the only runner present. (grill-room/package.json:15, grill-room/package.json:109)
- **Partial:** Reviewer verdict is a PR comment with file:line and a concrete failure and nits labelled non-blocking, but findings carry no severity field or evidence command. (.claude/templates/delegation/reviewer.md:22)
- **Partial:** The workflow's REVIEW schema returns a nits array, but review() only flattens findings; nits are never collected and the script's results drop them. (.claude/workflows/ticket-build-review-loop.js:51, .claude/workflows/ticket-build-review-loop.js:94-95)
- **Gap:** No step files a follow-up bead per PR after merge; merge and close stay in the main session, and nits are re-filed by hand as 'PR #N nits' beads (gr-6uc, gr-930, gr-6qx, gr-x6w, gr-axy). (docs/proposals/delivery-loop-gauntlet.md:48, .claude/rules/worktrees.md:85)
- **Built:** The workflow caps at two rounds then returns 'operator-decides', matching the two-fix-round cap the idea keeps. (.claude/workflows/ticket-build-review-loop.js:126-147)
- **Built:** Workflow takes filled templates through args, one reviewer template per lens, and a multi-lens run leaves gh pr ready to the main session; templates are the only place wording lives. (.claude/workflows/ticket-build-review-loop.js:12-18, .claude/workflows/ticket-build-review-loop.js:75-76)
- **Built:** The proposal this slice implements (changes 2, 3 and 5) is written, with open questions on score gating, who runs mutations, TDD, nit beads and token budget. (docs/proposals/delivery-loop-gauntlet.md:63-94, docs/proposals/delivery-loop-gauntlet.md:124-139)
- **Partial:** UI tickets already require a Playwright scenario under grill-room/e2e and agent-browser checks on an isolated server, but no before/after screenshot evidence in the PR body via the playwright-core script. (.claude/rules/worktrees.md:56-61, docs/proposals/delivery-loop-gauntlet.md:70)
- **Partial:** Benchmark file has the hand-loop-vs-workflow measures (tokens, time, rounds, interventions, post-approval findings) to extend; it lacks surviving mutants, findings proved only by tool, nit beads and evidence re-run columns. (docs/benchmarks/hand-loop-vs-workflow.md:12-22, docs/proposals/delivery-loop-gauntlet.md:116-122)
- **Partial:** No cost figure for Stryker exists, but the full suite is noted to time out under machine load and per-ticket costs are known from the A/B ($3 to $17 per ticket), so a mutation cap has a baseline. (docs/proposals/delivery-loop-gauntlet.md:77, docs/benchmarks/hand-loop-vs-workflow.md:53-60)
- **Partial:** Reviewers already find surviving mutants by hand (gr-2f9.7 round 1: two of four findings), which is the evidence a tool should replace. (docs/proposals/delivery-loop-gauntlet.md:46)

- **Commit read:** daa1670f7f813e39d00bc37b1a5bc9bab639d79c

The project has changed since this report was read.
