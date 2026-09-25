# 01 The handoff-scout request kind

Status: ready-for-agent
Blocked by: none
Suggested model: opus

## What to build

A new interviewer request kind, following the project scout's pattern exactly:
- request and result types;
- a strict result schema with bounded lists, shaped as the spec's Implementation Decisions say;
- a prompt builder;
- the CLI adapter, always on sonnet, with read-only tools at the project root, the same deny rules, and its own conversation;
- a fake scenario.

The prompt says:
- the spec and tickets define the work, and the code defines the facts;
- every claim must be cited;
- a file to create must be new and inside the project;
- for each blocker, name what the ticket needs from it.

## Builds on

The project scout's request kind, schema, prompt builder, CLI adapter branch, fake scenario, and the adapter contract tests. Confirm they exist first.

## How it will be judged

- Adapter contract tests: sonnet, read-only tools, deny rules, the project root, and a prompt carrying the spec, the tickets, their blockers and the facts.
- Schema tests for bounds and required fields.
- The fake serves the new kind from a named scenario.
- Verification: `pnpm exec vitest --run --maxWorkers=3` and `pnpm typecheck` from `grill-room/`.
