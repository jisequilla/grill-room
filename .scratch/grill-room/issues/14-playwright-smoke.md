# 14 Playwright smoke test

Status: ready-for-agent
Blocked by: 12, 13
Suggested model: sonnet

## What to build

Add Playwright and one smoke test against the running app with the fake interviewer enabled by configuration: create a session, answer and submit a round, see the tree update, confirm done, see the spec. Add a test:e2e script.

The spec at `.scratch/grill-room/spec.md` is the source of truth; read the sections relevant to this ticket before starting. Where this ticket and the spec disagree, stop and report rather than guess.

## Acceptance criteria

- `pnpm test:e2e` passes locally and starts/stops the app itself.
- The test never calls the real CLI.
- `pnpm test` and `pnpm typecheck` both exit 0 from `grill-room/`.

## Boundaries

- Work only inside `grill-room/`. Read `grill-room/AGENTS.md` and `grill-room/DEVELOPING.md` first, and use the framework's bundled, version-matched docs under `node_modules/@agent-native/core` rather than the public website.
- Behaviour is tested through actions against a real in-memory database with the fake interviewer; do not mock the store and never call the real Claude CLI from tests.
- `pnpm typecheck` prints production-deployment errors and a remediation prompt; this is a localhost-only app, so ignore them and change no deployment, auth, or environment configuration.
- Any MCP server goes through `mcp-cli` (for example `MCP_STRICT_ENV=false mcp-cli shadcn`, run from `grill-room/`), never a project `.mcp.json`.
- Never read, print, or commit `.env`.
