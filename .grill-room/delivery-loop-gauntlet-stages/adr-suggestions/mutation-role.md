# Mutation result: gate, report, or gate only on acceptance-covered lines

Suggested by Grill Room from the session "Delivery loop: gauntlet stages, PR evidence and mutation testing". Copy it into the repo's own ADR folder, in its own convention and numbering, then set its status there. This file is a working file: it is deleted with the rest of this folder.

- **Status:** Proposed
- **Decision key:** `mutation-role`

## Context

Stryker will run on the lines the PR changes. What does its result do to the review verdict? A gate means a surviving mutant blocks the PR on its own. A report means survivors are listed and the reviewer decides, by hand, which are real findings. A scoped gate blocks only when the survivor sits on a line an acceptance line claims to cover, which is where the Evidence section already promises a test.

## Decision

Gate on acceptance-covered lines, report elsewhere

## Alternatives

- Report only: Nothing new can block a PR, so the pilot measures the tool without the tool distorting the pilot. It costs you the discipline: a reviewer under pressure can wave survivors through and nothing stops them.
- Hard gate on every surviving mutant: Strongest guarantee of test strength and simplest to explain. It costs you false blocks on equivalent mutants and on incidental changes like logging or formatting, which will burn the two fix rounds on noise.

## Consequences

Commits the loop to a mapping from acceptance lines to changed line ranges in every PR body, and makes a surviving mutant on those lines a blocking finding by rule. It rules out a plain score threshold as the gate and makes a later move to a whole-diff gate a template change rather than a new mechanism.

## Tickets

- [04 Reviewer template: re-run evidence, judge survivors, three-level findings with evidence commands](../issues/04-reviewer-template-evidence-rerun-and-survivors.md)
