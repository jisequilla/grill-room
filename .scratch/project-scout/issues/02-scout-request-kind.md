# 02 Scout request kind in the interviewer port

Status: ready-for-agent
Blocked by: none
Suggested model: opus

Add `scout-project` as an interviewer request kind (see ../spec.md, "The scout turn" and "Scout report schema").

## What to build

- Request type in `server/interviewer/types.ts`: idea, title, server facts (ticket 01's shape; define the type here if 01 has not merged, matching the spec), and on a re-run the previous report's decisions.
- Strict result schema in `server/interviewer/schemas.ts`: `currentState` (at most 25 of `{ status: built|partial|gap, summary, citations[] }`), `proposedDecisions` (at most 15 of `{ key, title, statement, source: recorded|inferred, citation, reason }`), `previousDecisions` (`{ key, change: unchanged|changed|removed, statement? }`, empty on a first run). A citation is `path:line` or `path:start-end`.
- Prompt in `server/interviewer/prompt.ts`: read the project for this idea; propose only decisions that bear on it; label recorded vs inferred; cite every item; never invent a path.
- CLI adapter (`server/interviewer/claude-cli.ts`): the scout always runs with `--model sonnet`, in its own conversation, with docs mode's arguments (`docsModeArgs`) pointed at the project root, plus deny rules for `.env`, `.env.*`, private keys and certificates (`*.pem`, `*.key`, `id_rsa*`), and credential files.
- Fake interviewer (`server/interviewer/fake.ts`): scripts can queue `scout-project` results.

## Shares a boundary with

Ticket 03 validates citations against the repo and stores the result; ticket 06 relies on `previousDecisions`. Do not add storage or actions here.

## How it will be judged

- The contract test (`server/interviewer/claude-cli.test.ts`) asserts the scout invocation: sonnet whatever the session model, the project root as the only added directory, the read-only tool set, docs mode's restrictions and the deny rules.
- Schema tests: over-limit lists and malformed citations are rejected.
- **Real CLI secrets probe**, run by the agent and pasted in the PR: a scout run against a temporary repository with a planted `.env` holding a known marker must not return the marker, and the session transcript shows the read denied. If the deny rules do not take effect under `--restricted`, stop and report; do not work around it.
- Verification: `pnpm test` and `pnpm typecheck` from `grill-room/`.
