# 13 UI: session output (spec, tickets, build records, export)

Status: ready-for-agent
Blocked by: 09, 10, 11
Suggested model: sonnet

## What to build

Build the session output surface: rendered spec with regenerate and out-of-date indication; ticket list with status and blocked-by; build record view/edit per ticket and the session summary; export with target folder selection, overwrite confirmation, written-files report, and error display.

The spec at `.scratch/grill-room/spec.md` is the source of truth; read the sections relevant to this ticket before starting. Where this ticket and the spec disagree, stop and report rather than guess.

## Acceptance criteria

- User stories 62, 67, 70-75, 76-80 work in the browser.
- Typecheck passes; existing component kit only.
- `pnpm test` and `pnpm typecheck` both exit 0 from `grill-room/`.

## Boundaries

- Work only inside `grill-room/`. Read `grill-room/AGENTS.md` and `grill-room/DEVELOPING.md` first, and use the framework's bundled, version-matched docs under `node_modules/@agent-native/core` rather than the public website.
- Behaviour is tested through actions against a real in-memory database with the fake interviewer; do not mock the store and never call the real Claude CLI from tests.
- `pnpm typecheck` prints production-deployment errors and a remediation prompt; this is a localhost-only app, so ignore them and change no deployment, auth, or environment configuration.
- Any MCP server goes through `mcp-cli` (for example `MCP_STRICT_ENV=false mcp-cli shadcn`, run from `grill-room/`), never a project `.mcp.json`.
- Never read, print, or commit `.env`.
