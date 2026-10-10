# 2. Stryker runs as a workflow step before each review round, not inside a reviewer

- **Status:** Accepted
- **Decision key:** `mutation-runner`

## Context

The workflow runs one reviewer template per lens. Stryker is a command, not a judgment. There were three options:
- the tests lens runs the command itself, inside its agent;
- a new mutation critic agent runs it and writes findings;
- the workflow runs Stryker as a step before the reviewers and hands the survivor list to them as input.

## Decision

A workflow step runs the mutation before every review round and feeds every lens.

The suggestion asked for a plain shell step feeding the tests lens. As built, the step is an agent, because a workflow script cannot run a shell command.

In `.claude/workflows/ticket-build-review-loop.js`, before each review round, a resumed one included:
- a `sonnet` agent at `effort: low`, in its own worktree, runs `pnpm test:mutate --base origin/main`;
- it returns `summary.json` through a fixed schema;
- the script turns the summary into the text of each reviewer's `## Mutation` section.

Every lens gets the section, not only the tests lens.

## Alternatives

- **Tests lens runs Stryker itself.** No workflow change. It costs an LLM agent babysitting a long command, paying tokens for every line of Stryker output, and each lens re-running it if more than one lens wants it.
- **Separate mutation critic agent.** Clean separation and a dedicated template. It costs a whole extra agent whose only real work is reading a JSON report, which is the most expensive way to parse JSON.

## Consequences

- **The workflow has a step that judges nothing.** It runs once per round however many lenses there are, and it has its own cap (100 mutants) and failure modes (`overrun`, `runner-failed`).
- **A skipped gate is visible.** On either failure, the reviewers are told the gate was skipped and why.
- **A hand-run review has one more command.** `reviewer.md` tells a hand-loop reviewer to run `test:mutate` itself when the Mutation section holds no `Mutation run (round` line.
- **The step costs money.** In the pilot (gr-g4v.7) it cost $0.36 to $0.50 per round. One run hit `runner-failed` on a green suite; that is gr-g4v.10.

## Tickets

- gr-g4v.1: StrykerJS on vitest, with the diff-scoped `test:mutate` script (PR #183)
- gr-g4v.2: the mutation step before each review round, and the REVIEW schema (PR #185)
