# Delivery loop: gauntlet stages, PR evidence and mutation testing

Status: ready-for-agent

## Problem Statement

Every delivered PR in this repo is reviewed by an adversarial reviewer agent, but the review rests on trust and hand work. The builder claims each acceptance line is covered by a test that fails with the change reverted, yet the PR body does not quote the output, so the reviewer either re-derives it by hand or takes it on faith. Test strength is judged by a reviewer mutating code in scratch folders by hand, which is slow, inconsistent, and the kind of finding the last pilot showed a human reviewer catching only two out of four times. Review findings carry no severity and no command that reproduces them, so a blocking finding and a cosmetic nit look alike. The workflow's reviewer schema already returns nits, but the script drops them at the end of a run, and the operator re-files them by hand as follow-up beads after every merge. Nothing in the PR says whether merging is reversible or what it touches.

## Solution

Every PR carries its own evidence, review proves test strength with a tool, and findings are routed by severity. The PR body gains three sections: a Summary with the smallest sketch of the change, an Evidence section quoting a failing and passing run per acceptance line with the line ranges that test covers, and a Merge danger section naming the door type and blast radius. The reviewer re-runs the evidence with the same commands instead of trusting the quotes. A deterministic step in the saved workflow runs StrykerJS on vitest, scoped to the lines the PR changes, under a fixed cap, before every review round; survivors are handed to the tests lens reviewer, who turns them into findings. A survivor on a line an acceptance entry claims to cover is a blocker; elsewhere it is a nit. Findings carry one of three levels and, for blockers and should-fix items, the command that shows them. Blockers force a fix round, should-fix items ride along into a fix round that is already happening, and everything that did not block is returned by the workflow and filed by the main session as one follow-up bead per merged PR. A one-way door stops the main session for the owner's typed confirmation before merge. Three test-coverage tickets pilot the loop and extend the benchmark so the changes stay only if the tool proved something a human did not, the evidence re-ran, and cost stayed within the known range.

## User Stories

1. As the operator, I want every PR body to carry a Summary sketch of the change, so that I can grasp its shape before reading the diff.
2. As the operator, I want the Summary to be the smallest of a diff sketch, call tree, file tree or Mermaid diagram, so that it stays readable and not padded.
3. As a builder agent, I want an Evidence entry per acceptance line, so that each promise the ticket makes has a named test behind it.
4. As a builder agent, I want each Evidence entry to quote the failing run with the change reverted and the passing run with it, so that the test is proven to detect the change.
5. As a builder agent, I want one named revert mechanism in my template, so that I never reach for bare git stash and the reviewer can reproduce my red run.
6. As a builder agent, I want the revert mechanism to be a patch round trip scoped to source paths, so that the new test stays in place while the change is reverted.
7. As a builder agent, I want the exact revert commands written into my template, so that I do not improvise a different mechanism per ticket.
8. As a builder agent, I want each Evidence entry to list the line ranges the named test covers, so that the mutation gate can compare survivors against my claims.
9. As a builder agent, I want a Merge danger section stating one-way or two-way door and the blast radius, so that the main session knows how reversible the merge is.
10. As a builder agent, I want a migration to count as a one-way door, so that the rule is unambiguous for the most common irreversible change.
11. As a builder agent on a UI ticket, I want the playwright-core script to produce before and after screenshots, so that visual acceptance lines have evidence too.
12. As a builder agent on a UI ticket, I want screenshots written to the main checkout's scratch evidence folder by absolute path, so that they survive the worktree being pruned after merge.
13. As a builder agent on a UI ticket, I want the PR body to name the screenshot path and the regenerating command, so that the reviewer can rebuild the images instead of trusting them.
14. As the operator, I want nothing binary committed for screenshots, so that the repo does not grow with PNGs.
15. As the operator, I want the scratch folder ignored through the repo's local exclude file, so that evidence never appears as an untracked change.
16. As a reviewer agent, I want to re-run every quoted fail-then-pass pair with the same two commands, so that the evidence is verified rather than believed.
17. As a reviewer agent, I want a test that passes with the change reverted to be a blocker, so that a weak test cannot merge behind a true-looking quote.
18. As a reviewer agent, I want a stale quote with a correct test to be a nit about the PR body, so that an environment difference does not burn a fix round.
19. As a reviewer agent, I want the red run in Evidence to be sufficient TDD proof, so that I do not have to audit commit order that a rebase would break.
20. As a reviewer agent, I want to regenerate UI screenshots from the named command, so that visual evidence is checked the same way as test evidence.
21. As the operator, I want StrykerJS on vitest added to grill-room as pinned dev dependencies with a config and an npm script, so that the builder, reviewer and a hand loop all run the same command.
22. As the operator, I want the Stryker config minimal, so that there is one runner, per-test coverage, cap values and a JSON reporter and nothing else to maintain.
23. As the workflow, I want to run Stryker as a deterministic step between build and review, so that no LLM agent pays tokens babysitting a long command.
24. As the workflow, I want to run Stryker before every review round on the full PR diff against main, so that round two judges the code it is actually reviewing and sees whether the fix killed the survivors.
25. As the workflow, I want Stryker scoped to the changed line ranges computed from the diff, so that every mutant is about this PR and the run stays inside the cap.
26. As the workflow, I want test files and unchanged source files excluded from mutation, so that mutants are not generated where the PR made no claim.
27. As the workflow, I want a test-only PR to mutate the source lines its changed test files cover, so that a test-coverage ticket can still exercise the tool.
28. As the workflow, I want the coverage ranges for a test-only PR derived from a vitest coverage run of only the changed test files, so that the scope is exactly what the ticket claims to add.
29. As the workflow, I want a cap of ten minutes wall clock, one hundred mutants, concurrency two and per-test coverage, so that a loaded machine does not stall the loop.
30. As the workflow, I want the cap enforced by the script, so that no agent can decide to run longer.
31. As the workflow, I want the actual run time, mutant count and score recorded per run, so that the pilot produces the cost figure the proposal lacks.
32. As the workflow, I want an overrun, truncation or runner failure reported as a non-blocking note that skips the gate, so that the loop finishes and the miss is recorded as data.
33. As the workflow, I want to pass the tests lens reviewer only the survivor subset with file, line, mutator and run status, so that the reviewer does not pay tokens for the full JSON report.
34. As a reviewer agent on the tests lens, I want a survivor list as filled input to my template, so that my job is judgment, not running a tool.
35. As a reviewer agent, I want my template to document the mutation command, so that a hand-run loop can reproduce the step without the workflow.
36. As a reviewer agent, I want a survivor on a line an acceptance entry covers to default to a blocker, so that a gap in the very test the builder quoted blocks the PR.
37. As a reviewer agent, I want a survivor outside acceptance-covered lines to default to a nit, so that the pilot shows how noisy a full gate would have been without blocking on it.
38. As a reviewer agent, I want to downgrade a survivor only with the mutant quoted and a reason no test could kill it, so that every downgrade is auditable.
39. As a reviewer agent, I want to own the equivalent-mutant call in the verdict, so that the builder cannot wave away real gaps.
40. As a builder agent in a fix round, I want to propose that a mutant is equivalent, so that I am not forced to write a test that cannot exist.
41. As the operator, I want no persistent ignored-mutant file committed during the pilot, so that nothing drifts with the code before the tool has proven itself.
42. As the operator, I want the mutation score recorded but never gated on, so that the benchmark has a column without a small diff turning the gate into a lottery.
43. As a reviewer agent, I want three finding levels, blocker, should-fix and nit, so that I can distinguish a merge stopper from a worthwhile fix from a cosmetic note.
44. As a reviewer agent, I want each blocker to carry the command that shows it, so that the builder and the operator can reproduce it.
45. As a reviewer agent, I want each should-fix item to carry an evidence command, so that it is actionable when it lands in the follow-up bead.
46. As a reviewer agent, I want each nit to carry file and line and a one-line fix, so that the follow-up bead is readable months later.
47. As a reviewer agent, I want the verdict to be pass when only should-fix and nit items remain, so that non-blocking findings never consume a fix round by themselves.
48. As a builder agent in a fix round, I want should-fix items included when a blocker already forces the round, so that they are fixed while the cost is lowest.
49. As a builder agent in a fix round, I want to re-quote only the Evidence entries whose test or ranges changed, so that the PR body stays true without re-running everything.
50. As a builder agent in a fix round, I want to add an Evidence entry for each new test I wrote to kill a survivor, so that round two can verify it.
51. As a builder agent in a fix round, I want to add a round line under Merge danger when the blast radius changed, so that the main session merges on current information.
52. As the workflow, I want one findings array with level, file, line, claim, evidence command and an optional equivalent-mutant note, so that routing is a filter over one shape.
53. As the workflow, I want the review step to carry every finding through to the script's result, so that nits and should-fix items are no longer dropped at the end of a run.
54. As the workflow, I want the two-round cap and the operator-decides outcome unchanged, so that the loop does not run away.
55. As the main session, I want to file one follow-up bead per merged PR, so that the backlog stays readable and matches existing practice.
56. As the main session, I want the bead filed only after merge, so that a rejected PR never leaves an orphan bead.
57. As the main session, I want the bead at priority three with the pr-nits label and a title naming the PR number and ticket, so that a sweep is one query and the bead links back.
58. As the main session, I want each bead entry formatted with level, file and line, one-line fix, evidence command for should-fix, and the round in which it was addressed if any, so that someone picking it up later can reproduce or skip each item.
59. As the operator, I want reviewers never to write beads, so that the adversarial party does not also own the backlog.
60. As the main session, I want a one-way door in Merge danger to stop and ask for the owner's typed confirmation before merge, so that the section has a consumer.
61. As the main session, I want to delete the scratch evidence folder for a PR when its nits bead closes, so that images live as long as something references them and no longer.
62. As the operator, I want the rules file to record the post-merge bead filing and evidence cleanup, so that the main session's checklist is explicit.
63. As the operator, I want gr-6uc, gr-930 and gr-x6w run through the changed loop, so that the changes are measured on real tickets.
64. As the operator, I want the benchmark extended with Stryker time per run, score, surviving mutants, findings proved only by tool, nit beads filed and evidence re-run result, so that the pilot is comparable with the hand-loop-vs-workflow numbers.
65. As the operator, I want the changes kept only if the tool found a survivor a human did not, every Evidence pair re-ran, and per-ticket cost stayed within the known range, so that a no-value result is itself an answer.
66. As the operator, I want pre-flight, merged-with-main verification and the merge to stay in the main session, so that this slice changes evidence and review without moving control.
67. As the operator, I want a launch to still require the owner's typed message, so that the new sections add no automation to the launch step.

## Implementation Decisions

**Templates.** The builder template gains the three-section PR body: Summary, Evidence and Merge danger. Each Evidence entry names the test, lists the source line ranges it covers in path and start-end form, and quotes the red run with the change reverted and the green run with it. The revert mechanism is a single patch round trip: write the diff of source files against main to a patch, reverse-apply it, run the named test, re-apply. It is scoped to source paths so the new test stays in place. The same commands appear verbatim in the builder, fix and reviewer templates. The red run is sufficient TDD proof; no commit-order rule is added. UI tickets add before and after screenshots produced by the playwright-core script into the main checkout's scratch evidence folder, named by absolute path, with the regenerating command in the PR body. Merge danger states one-way or two-way door and the blast radius; a migration is one-way.

**Reviewer template.** The reviewer re-runs every Evidence pair with the same two commands and regenerates screenshots. A test that passes with the change reverted is a blocker; a stale quote with a correct test is a nit. The tests lens template takes a survivor list as filled input and documents the mutation command for a hand loop. The reviewer owns equivalent-mutant calls, written in the verdict with the mutant quoted; a downgrade of any survivor requires the mutant quoted and the reason no test could kill it.

**Mutation step.** StrykerJS with the vitest runner is added to grill-room as pinned dev dependencies, with a minimal config (vitest runner, per-test coverage analysis, concurrency and timeout from the cap, JSON reporter into the scratch folder) and an npm script that accepts mutate ranges. The saved workflow runs it as a deterministic non-agent step before every review round, on the full PR diff against main. Scope is changed line ranges per file computed from a zero-context diff; test files and unchanged files are excluded. When the PR changes only tests, scope is the source lines covered by a vitest coverage run of the changed test files. Cap: ten minutes wall clock, one hundred mutants, concurrency two. Overrun, truncation or runner failure is reported as a non-blocking note and the gate is skipped for that run. The step records time, mutant count and score, and passes the reviewer only survivors with file, line, mutator and run status. The score is recorded, never gated on.

**Severity and routing.** Three levels: blocker, should-fix, nit. A survivor on a line an acceptance entry covers defaults to blocker; elsewhere to nit. Blockers carry the command that shows them and force a fix round. Should-fix items carry an evidence command, appear in the verdict, are fixed in a fix round only when a blocker already forces one, and never block alone; the verdict is pass when only should-fix and nit items remain. The fix round re-quotes only touched Evidence entries, adds entries for new tests, and adds a round line under Merge danger if blast radius changed. The two-round cap and operator-decides outcome are unchanged.

**Review schema.** One findings array; each entry has level, file, line, claim, evidence command (required for blocker and should-fix) and an optional equivalent-mutant note. The separate nits array goes away. The review step carries all findings through to the script's result.

**Nit beads.** The workflow returns non-blocking findings in its result; the main session files one bead per merged PR, priority three, label pr-nits, title naming the PR number and ticket. Each entry lists level, file and line, one-line fix, evidence command for should-fix, and "addressed in round N" when applicable. Reviewers never write beads. The rules file records the filing step after merge.

**Main session.** A one-way door requires the owner's typed confirmation before merge. The scratch evidence folder for a PR is deleted when its nits bead closes. Pre-flight, merged-with-main verification and merge stay in the main session; a launch needs the owner's typed message.

## Testing Decisions

A good test exercises external behaviour: given a PR diff, the mutation step produces the expected scope ranges, respects the cap, and emits the survivor subset shape; given a findings array, routing places each level in the verdict, the fix round or the bead as decided. Implementation details such as how hunks are parsed are not asserted.

Modules tested: the diff-to-ranges script (source hunks, excluded test files, test-only PR coverage path), the cap enforcement and overrun reporting of the workflow step, the review schema validation, the routing filter from findings to verdict and bead, and the bead entry formatting. Templates are exercised through the pilot rather than unit tests.

Prior art: the existing workflow schema validation in the saved workflow, grill-room's vitest suite, and the hand-loop-vs-workflow benchmark as the measurement harness. The pilot itself is the acceptance test: three tickets, benchmark columns for Stryker time and score, surviving mutants, findings proved only by tool, nit beads filed and evidence re-run result, with the keep criterion of at least one tool-only survivor, every Evidence pair re-running, and per-ticket cost within three to seventeen dollars.

## Out of Scope

The rest of the gauntlet proposal: the ticket gauntlet, verification inside the workflow, the visual critic, the linter and the hotspot report. Moving pre-flight, merged-with-main verification or the merge out of the main session. Changing the two-round cap or the launch confirmation rule. A persistent ignored-mutant file for Stryker. Committing screenshots or any evidence binary. A numeric mutation score gate. One-bead-per-nit filing. Tightening the Stryker cap or the overrun policy before the pilot reports.

## Further Notes

The cap and the overrun policy are pilot values; the benchmark's per-run Stryker numbers are the input for tightening them. If the tool finds nothing on three test-coverage tickets, that result is itself the answer to whether the changes stay. The scout report was read at an earlier commit and may be stale on exact line references, but no decision depends on them.