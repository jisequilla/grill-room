# 04 The smoke test covers decisions.md

Status: ready-for-agent
Blocked by: 01
Suggested model: sonnet

## What to build

- The existing end-to-end smoke test's export step asserts decisions.md appears in the export preview and, after export, is written with at least one entry. If the default canned scenario settles nothing that qualifies, adjust the smoke test's answers, not the renderer.

## Builds on

Ticket 01, and the smoke spec and its support helpers. Confirm they exist first.

## How it will be judged

- `just e2e` from the repo root passes, with the smoke test asserting the above, plus `pnpm exec vitest --run --maxWorkers=3` and `pnpm typecheck`.
- Browser servers run only on free ports the agent chose, and are stopped only by the PIDs the agent recorded.
