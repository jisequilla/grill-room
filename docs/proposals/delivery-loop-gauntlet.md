# Delivery loop: gauntlet stages, PR evidence and mutation testing

A proposal for changing how a ready ticket travels from pre-flight to merge. Nothing here is built. It is the input to a grill, and its open questions are the decisions that grill has to settle.

The loop it changes is the one in `.claude/rules/worktrees.md`. Grilling, ticket writing, owner decisions, and the main session's verification and merge stay as they are.

## Where the ideas come from

- **The Gauntlet loop**, as presented in [this video](https://www.youtube.com/watch?v=IA_zUI1Q6pY) and credited to a prompt Matt Shumer published. The video is a course advertisement, and its figures are second-hand and unchecked: a 19-hour run with 137 agents, and a paper where an agent claimed improvement in all 54 cycles. The pattern stands without them.
- **Matt Pocock's `pr` skill** ([`skills/engineering/pr`](https://github.com/mattpocock/skills/blob/main/skills/engineering/pr/SKILL.md)), for the PR body: Summary, Evidence, Merge Danger.
- **The owner**, for:
  - routing review findings by severity, with evidence;
  - TDD;
  - mutation testing run by the reviewer;
  - code metrics.

### The Gauntlet loop in brief

A plain loop has one builder and one critic. A gauntlet changes three things:

1. **The work is split.** A lead agent splits the goal and fans out sub-agents, each owning one piece.
2. **Each piece faces its own blind critic.** The critic never sees the builder's code or excuses, only the output. It judges that output against a concrete benchmark, such as reference screenshots.
3. **There is no finish line.** The loop runs until every critic is satisfied.

The video's warnings matter more than its claims:
- **A vague bar.** Without something concrete to compare against, the critics drift into agreeing with the builder.
- **No natural end.** The loop never stops on its own, so a human ends it.
- **Critics need tools.** The longest run built its own judging tools before building the product, so its critics had evidence rather than opinions.

## The loop today

How the gauntlet's ideas map onto the current loop:

| Gauntlet idea | Today |
|---|---|
| Split the work | Grilling settles the decisions, the main session writes tickets with behaviour tables, and a sonnet pre-flight reads each ticket against the code |
| A critic per piece | One opus reviewer per ticket, or two lenses (correctness, tests) when the ticket touches a server check, a schema or a model prompt |
| Blind critics | Reviewers get fresh context, the ticket and the diff, never the builder's report |
| A concrete benchmark | The behaviour table, and the rule that each acceptance test fails with its change reverted |
| No finish line | Two fix rounds, then the operator decides |
| Critics build tools | None: reviewers check the revert rule by hand |

What the record shows:
- **`docs/delegation-log.md` has 193 rows.** 117 passed on the first attempt, 68 did not, and 1 escalated from sonnet to opus. Failures come from tickets and tests, not from model strength.
- **The commonest defect is a test that cannot fail.** On 2026-10-10 alone, three tickets carried a behaviour row that could not fail on its own rule (gr-2f9.5, gr-2f9.6, gr-0hy.7; the beads memory `ticket-rows-must-isolate-their-rule`).
- **Reviewers already mutate by hand.** In gr-2f9.7 (PR #175), two of the four round-1 findings were mutations that survived the suite: replacing `history,` with `history: {}`, and dropping `oneLine` on a title.
- **Pre-flight is the main session's biggest relay cost.** gr-2f9.7 and gr-2f9.8 took seven pre-flight rounds between them, and the main session relayed each by hand.
- **Non-blocking nits get lost.** They are posted as PR comments and later re-filed as beads by hand: gr-6uc, gr-930, gr-6qx, gr-x6w and gr-axy are all "PR #N nits".
- **The code has no linter and no complexity budget.** `server/handoff.ts` is 2,447 lines and changed in 40 commits over the past month, more than any other server file.

## Proposal

Each change below can be adopted or rejected on its own.

### 1. A ticket gauntlet before the build

The pre-flight critic and a ticket fixer loop until the ticket is clear, with a round cap.
- The critic is the current pre-flight template.
- The fixer edits the ticket only, never code.
- The loop stops early on an owner decision. A workflow cannot ask the owner mid-run, so it returns the question and the main session asks it.
- The main session reads the cleared ticket before launch, as today.

### 2. A PR body that shows evidence and merge danger

The builder writes the body from Matt Pocock's template:

| Section | Content |
|---|---|
| **Summary** | The smallest view of the change: a diff sketch, call tree, file tree or Mermaid diagram |
| **Evidence** | For each acceptance line, the named test failing with the change reverted, then passing with it, quoted from the command output. For a UI ticket, before and after screenshots taken with the playwright-core script (`agent-browser`'s screenshot command fails here) |
| **Merge danger** | One-way or two-way door, then the blast radius in one word with its ramifications. A migration is a one-way door |

The reviewer re-runs the evidence commands rather than trusting the quoted output: a builder's report is a claim.

### 3. Diff-scoped mutation testing, run by the reviewer

StrykerJS supports vitest. The reviewer runs it on the lines the PR changes, not on the whole suite: the full suite already times out under machine load. The results are:
- the mutation score of the changed lines;
- each surviving mutant, as a finding with file:line, the mutation and the suite result.

This turns the revert rule from a check a reviewer remembers to do into a tool's output, the gauntlet's "critics build their own tools".

### 4. Verification inside the loop

The workflow runs the verification on the branch merged with `main` (vitest, typecheck, and `just e2e` when the ticket touches the UI). It runs after the reviewers approve, and a failure goes back to the fixer. The main session still verifies before merging, as `worktrees.md` requires, but should find nothing.

### 5. Findings routed by severity, each with evidence

| Severity | Where it goes | When it is resolved |
|---|---|---|
| Blocking | The verdict comment on the PR, with file:line, severity and the evidence (the command and its result) | In the next fix round, on the same branch |
| Non-blocking | Collected from every reviewer by the workflow, and filed after merge as one follow-up bead per PR | Later, from `bd ready` |

Reviewers do not create beads themselves. Parallel agents writing to the bead database from worktrees would produce near-duplicate beads.

### 6. A visual critic for UI tickets

It is a blind critic that sees only screenshots of the built screens, compared with `grill-room/DESIGN.md` and reference shots. It suits the redesign epic (gr-yys), which has nine open UI tickets.

### 7. A linter ratchet and a hotspot report

- **The ratchet.** ESLint's `complexity`, `max-lines` and `@typescript-eslint/naming-convention` rules, applied to changed files only. A PR may not make a changed file worse. It does not have to fix what it found.
- **The hotspot report.** Change frequency crossed with complexity, plus files that always change together, plus mutation score per module. It is read periodically by the owner, and a refactor ticket comes from reading it, never from a threshold.

Size, naming and cyclomatic complexity cannot by themselves say whether the architecture needs a rewrite. Where change concentrates, and what the tests fail to pin, can.

### What stays

- At most a fixed number of rounds, then the operator decides. A loop with no finish line would drain the subscription pool that the app, the subagents and the main session share.
- The owner answers every owner decision.
- The main session verifies and merges every PR.
- A launch still needs the owner's typed message naming the tickets.

## Pilot

Run one batch of three test-coverage tickets through the new loop, for example from gr-6uc, gr-930, gr-x6w, gr-c0t.23, gr-yys.18 and gr-yys.19. Record it in `docs/benchmarks/` with the measures of `hand-loop-vs-workflow.md`:
- subagent tokens and wall time;
- main-session interventions;
- review rounds;
- what main-session verification found after approval.

Add two new measures: the surviving mutants found by the tool, and the nit beads filed.

## Open questions

These are what the grill has to settle:

1. **Mutation testing.**
   - StrykerJS, the reviewer's hand mutations, or both?
   - Is the score a gate, a report, or a gate only on the lines that acceptance lines cover?
2. **Who runs the mutations.** The tests lens, or a separate mutation critic with no lens judgment?
3. **TDD.** Is the red run in the Evidence section enough, or must the commits show the test before the change?
4. **The ticket gauntlet's cap.** How many rounds before the main session takes over?
5. **Nit beads.** One per PR or one per nit, at what priority, and filed by the workflow or the main session?
6. **The linter.** ESLint, or a faster one such as oxlint or Biome? Which rules, and at what thresholds?
7. **The hotspot report.** How often is it produced, and where does it live?
8. **The visual critic.** Do reference shots exist for the gr-yys screens, or must they be made first?
9. **The token budget.** Is there a per-ticket cap, and what happens when a run reaches it?
10. **The pilot.** Which three tickets, and what result would make the new loop the default?
