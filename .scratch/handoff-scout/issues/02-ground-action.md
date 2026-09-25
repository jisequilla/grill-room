# 02 "Ground the briefs": action, checks, storage, staleness

Status: ready-for-agent
Blocked by: 01
Suggested model: opus

## What to build

- The grounding record: an additive table or columns, per session, holding exactly the fields in the spec's Implementation Decisions under Storage.
- The rejection check:
  - reuses the citation check;
  - adds every rule in the spec's Implementation Decisions under The rejection check.
- A `ground-briefs` action:
  - runs through the turn lock and turn records;
  - refuses with its own codes in each case the spec names;
  - stores the accepted result.
- A read action returns the grounding, with `current` or stale and the reason: HEAD moved, or the handoff changed.

## Builds on

Ticket 01, the project scout action (`scoutProjectCore`), the citation check, `runTurn`/`askUntilAccepted`, the handoff and its fingerprint, and the project facts. Confirm they exist first.

## How it will be judged

- Every action test in the spec's Testing Decisions, with a temporary git repo and the scripted fake.
- Verification: `pnpm exec vitest --run --maxWorkers=3` and `pnpm typecheck` from `grill-room/`.
