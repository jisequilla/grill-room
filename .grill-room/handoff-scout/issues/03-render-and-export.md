# 03 Grounded briefs, and the export's grounding state

Status: ready-for-agent
Blocked by: 02
Suggested model: sonnet

## What to build

- The brief renderer fills File boundaries and Codebase facts, and adds "Builds on" and "Proved by", from current grounding. Stale grounding renders with its "grounded at an earlier commit / for earlier tickets" line. With no grounding, today's slots stay. An edited brief keeps its text.
- The export preview reports the grounding state (absent, current, or stale with its reason) and never blocks.

## Builds on

Ticket 02's grounding read, the brief renderer and its slots, and the preview-export action. Confirm they exist first.

## How it will be judged

- Renderer tests with exact text for: current grounding, stale grounding, no grounding, and an edited brief.
- An export preview test for all three states.
- Verification: `pnpm exec vitest --run --maxWorkers=3` and `pnpm typecheck` from `grill-room/`.
