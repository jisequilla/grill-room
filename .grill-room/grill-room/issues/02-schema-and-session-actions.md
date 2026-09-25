# 02 Schema and session actions

Status: ready-for-agent
Blocked by: 01
Suggested model: sonnet

## What to build

Define the full domain schema from the spec's Domain model section (session, decision, decision history, round, spec, ticket, build record, global settings) using the framework's schema helpers, additive migrations only. Implement session actions: create (title, idea, model defaulting to the global setting, answering mode), list (title, state, last activity), get, delete, set answering mode, and get/set the global default model.

The spec at `.grill-room/grill-room/spec.md` is the source of truth; read the sections relevant to this ticket before starting. Where this ticket and the spec disagree, stop and report rather than guess.

## Acceptance criteria

- User stories 1-8, 10, 11 are satisfied at the action level.
- Deleting a session removes its decisions, rounds, spec, tickets and build records.
- Action tests cover each action against the in-memory database.
- `pnpm test` and `pnpm typecheck` both exit 0 from `grill-room/`.

## Boundaries

- Work only inside `grill-room/`. Read `grill-room/AGENTS.md` and `grill-room/DEVELOPING.md` first, and use the framework's bundled, version-matched docs under `node_modules/@agent-native/core` rather than the public website.
- Behaviour is tested through actions against a real in-memory database with the fake interviewer; do not mock the store and never call the real Claude CLI from tests.
- `pnpm typecheck` prints production-deployment errors and a remediation prompt; this is a localhost-only app, so ignore them and change no deployment, auth, or environment configuration.
- Any MCP server goes through `mcp-cli` (for example `MCP_STRICT_ENV=false mcp-cli shadcn`, run from `grill-room/`), never a project `.mcp.json`.
- Never read, print, or commit `.env`.
