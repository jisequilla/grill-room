# 02 Scenarios for every request kind

Status: ready-for-agent
Blocked by: 01
Suggested model: sonnet

## What to build

Named scenarios in the registry (ticket 01), built from the existing scripted-turn builders:
- `readiness-ready` and `readiness-not-ready`
- `reopen-stale-review`: a round, then after a reopen a stale review that reconfirms one dependent and re-asks another
- `supersession`: a done proposal with a loose end the supersession check proposes as superseded
- `refusal-then-success`: a propose-round refused once for a tree-rule violation, then accepted
- `rate-limit-then-retry`: a propose-round rate limited, then accepted on a manual retry, with a delay long enough to see the running turn
- `scout-project`: a first scout report with current state and two proposed decisions (the scout feature's UI tickets use it)

Each scenario scripts the whole path its browser test needs, from the first request of a new session.

## How it will be judged

- A module test per scenario drives it through the fake with the requests its flow makes, in order, and checks each answer is served and the queue ends empty.
- Every scripted result validates against its kind's schema (the fake already checks this).
- Verification: `pnpm exec vitest --run --maxWorkers=3`, `pnpm typecheck`.
