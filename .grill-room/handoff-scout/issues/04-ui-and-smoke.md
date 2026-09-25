# 04 "Ground the briefs" in the UI, and the smoke test

Status: ready-for-agent
Blocked by: 03
Suggested model: sonnet

## What to build

- A "Ground the briefs" control on the output page near the handoff, with its running and failed states the way other turns show them, and the grounding state shown beside it.
- The export preview shows the grounding warning.
- The smoke test grounds the briefs through a fake scenario and asserts a brief shows the filled parts.

## Builds on

Tickets 02 and 03, the output page's handoff section, the live turn UI, and the smoke test. Confirm they exist first.

## How it will be judged

- `just e2e` passes with the extended smoke test.
- A browser check with `agent-browser` on the agent's own server.
- Verification: `pnpm exec vitest --run --maxWorkers=3` and `pnpm typecheck`.
