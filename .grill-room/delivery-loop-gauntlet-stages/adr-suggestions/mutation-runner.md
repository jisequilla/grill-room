# Who runs Stryker: the tests lens, a separate mutation critic, or a deterministic workflow step

Suggested by Grill Room from the session "Delivery loop: gauntlet stages, PR evidence and mutation testing". Copy it into the repo's own ADR folder, in its own convention and numbering, then set its status there. This file is a working file: it is deleted with the rest of this folder.

- **Status:** Proposed
- **Decision key:** `mutation-runner`

## Context

The workflow already runs one reviewer template per lens. Stryker is a command, not a judgment. Options: the existing tests lens reviewer runs the command itself inside its agent; a new mutation critic agent runs it and writes findings; or the workflow script runs Stryker as a plain shell step before the reviewers and hands the survivor list to the tests lens as input.

## Decision

Deterministic workflow step feeding the tests lens

## Alternatives

- Tests lens runs Stryker itself: No workflow change. Costs an LLM agent babysitting a long command, paying tokens for every line of Stryker output, and each lens re-running it if more than one lens wants it.
- Separate mutation critic agent: Clean separation and a dedicated template. Costs a whole extra agent whose only real work is reading a JSON report, which is the most expensive way to parse JSON.

## Consequences

Commits the saved workflow to a non-agent step with its own cap and failure mode, and makes the tests lens template take a survivor list as input. Rules out lens-local mutation runs and means review done outside the workflow has one more manual command.

## Tickets

- [02 Run Stryker before each review round in the workflow and reshape the REVIEW schema](../issues/02-workflow-mutation-step-and-review-schema.md)
