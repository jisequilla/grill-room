# 04 The smoke test covers intent.md and the guard

Status: ready-for-agent
Blocked by: 01, 03
Suggested model: sonnet

## What to build

The smoke test, after its first export:

1. Asserts intent.md was written.
2. Edits the exported spec.md on disk.
3. Opens the preview and asserts spec.md is flagged as edited.
4. Re-exports and asserts spec.md is unchanged and listed as kept.
5. Ticks its "Overwrite anyway" checkbox, re-exports, and asserts spec.md is overwritten.

## Builds on

Tickets 01 and 03, and the smoke test's existing export step and temporary project. Confirm they exist first.

## How it will be judged

- `just e2e` passes with the extended smoke test, plus `pnpm exec vitest --run --maxWorkers=3` and `pnpm typecheck`.
- Browser servers only on free ports the agent chose, stopped only by recorded PIDs; the user's server on 8082 is never touched.
