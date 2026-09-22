# PoC findings: planning on Fable, building on Opus and Sonnet

## The question

Can a top-tier model do the judgment work of a software build (grilling the idea, writing the spec, cutting tickets, reviewing results, deciding what is done) while cheaper models do all the implementation, with the split measured rather than assumed?

The subject was Grill Room, a local app that runs Matt Pocock's grilling interview as a structured workspace instead of a chat: rounds of question cards, a design tree whose states the app derives, steering moves, reopening with stale review, a done gate, spec synthesis, ticket breakdown, export, and build records. It was specified with the `grill-me` and `to-spec` skills in this repository, built on the agent-native framework, and drives Claude through the Claude Code CLI on a subscription, with no API key.

## The numbers

| | |
|---|---|
| Delegated tasks | 32 tickets and 1 spike |
| Model split | 15 on Opus, 17 on Sonnet, all via the Agent tool with an explicit model override; the main session (Fable) wrote no implementation code |
| Escalations from Sonnet to Opus | 0 |
| First-attempt passes | 28 of 31 first-attempt tickets; the three exceptions are a session restart that killed two agents before they committed, and one ticket revised from pass to fail after a defect surfaced post-merge |
| Delegation prompts with a gap the agent had to work around | 24 of 33; 9 reported none |
| Merges | 28 ticket merges onto `main`, every one behind a trial merge and the full suite (unit, type check, browser smoke) run on the merged tree before committing, after the first two merges taught that lesson |
| Final state | 38 actions, 452 tests across 39 files, 1 end-to-end browser test, ~17,000 lines of TypeScript, 135 commits |
| First real session | 72 decisions, 96 rounds, 7 reopens with real stale reviews, a spec of 35 user stories and 18 tickets exported in the local-markdown tracker layout |

## What the numbers say

**Sonnet handled every ticket where the decisions had been made before delegation.** The schema, the orphaned-frontier fix, the steering moves, the done gate, the spec and ticket synthesis, export, build records, the smoke test, the ordering audit: all Sonnet, all first-attempt passes. The pattern held across seventeen tickets: when the prompt named the files, the behaviours, the error codes and the test cases, the cheaper model produced clean work. The tickets given to Opus were the ones where a decision still had to be made inside the task (the tree engine, the interviewer port, the integration of two parallel tickets, the security-sensitive docs mode), and Opus made those decisions well and said which ones it had made.

**Zero escalations is not a claim that Sonnet never needed help.** It is a claim about the prompts: a ticket was not delegated until it could be specified tightly, and that discipline moved the difficulty upstream, into the main session's planning. The delegation log records where that planning fell short.

**Every defect that got past the tests lived between tickets, not inside one.** The table-name collision (the framework already owned a `sessions` table, so the app returned 500 on any fresh database while every test passed), the orphaned frontier (a decision added as blocked could never be asked once it unblocked, because ticket 03's port and ticket 04's engine each encoded half of the contract), the duplicated turn bookkeeping that fell out of step one ticket later, the type error at the seam of two parallel UI tickets. None of these was a model failure. Each was a gap in how the planner cut the work or verified the join, and each was found only by running the real app, not the tests.

**Twenty-four of thirty-three prompts had a gap the agent reported.** Missing leads on how the framework resolves its database handle, a latency figure taken from a trivial probe, CLI flags that had never met a real prompt, a stop condition, a commit instruction that the repository's own tracker block appeared to contradict, a wrong baseline commit, a file put off-limits that the task needed. The agents worked around most of them and, importantly, said so in their reports. The rule that made this measurable was one line in every prompt: "report what in these instructions was missing, wrong, or unclear."

## What the process taught

- **A mid-task message is not a delegation.** A scope change sent to a running agent arrived after it had finished; its worktree had been removed by then. Scope changes need their own ticket.
- **Verify the deed, not the report.** Agents' reports were accurate throughout, but the checks that found defects were the main session's own: booting the app on an empty database, running two real interviewer rounds, reproducing a CLI denial, looking at screenshots. A merge order that ran the combined suite before committing caught two seam failures that per-branch suites could not.
- **Parallel work on shared files costs a third ticket.** Two tickets built on the same module in parallel merged without conflict only because one duplicated code; the duplicate diverged within a ticket, and a cleanup ticket had to unify it. Parallel work on disjoint files (backend beside UI, export beside build records) paid off every time.
- **Give UI agents a browser.** Once agents could screenshot their own screens, they found and fixed visual defects before reporting: a viewport grid inside a narrow aside, a steering row that wrapped, loose-end answers coloured like settled ones.
- **The first real user session found what no ticket could.** The user could not judge the alternatives because the recommendation carried a median 146 characters of reasoning and each other choice 29; the UI guessed which chip was the recommendation and guessed wrong four times in five; three loose ends had already been answered by later decisions and still blocked confirmation; and the design being grilled already existed on disk, unnoticed, because the method does no fact-finding. Each became a ticket, and the tickets were built the same way as the rest.

## On the method itself

Grill-me worked as a container for the interview, and the design tree did the one thing chat cannot: reopening a decision made exactly the right dependents stale, and the interviewer reconfirmed or re-asked each with a reason. Two limits showed clearly. Without fact-finding, the interviewer will happily design a system you already built; grill-with-docs mode now exists for that. And the asymmetry between a reasoned recommendation and bare-label alternatives quietly steers the user toward accepting; the port now asks for a rationale per choice and an explicit recommended index.

## Where the evidence is

- `docs/delegation-log.md`: one row per delegated task with model, outcome and the prompt gap.
- `docs/design/session-retrospective.md`: the first real session in numbers and what it changed.
- `docs/design/monitor-comparison.md`: the grilled design against the existing system it turned out to duplicate.
- `docs/design/workspace-review.md`: the design review and its verification.
- `docs/spikes/claude-code-harness.md`: why the app calls `claude -p` instead of the framework's harness.
- The beads store (`bd list --status=closed`): every ticket's close comment carries the verification evidence.
