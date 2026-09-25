# 10 Build records

Status: ready-for-agent
Blocked by: 08
Suggested model: sonnet

## What to build

Implement build records per the spec: one per ticket, holding model, first attempt passed, escalated, what the prompt was missing, and notes. Actions to set/edit a record and to summarize records across a session (first-attempt pass rate, escalations). The set action must be callable over HTTP and the framework's action CLI so an orchestrating agent can log results without a browser; document the exact invocation in the app's AGENTS.md.

The spec at `.grill-room/grill-room/spec.md` is the source of truth; read the sections relevant to this ticket before starting. Where this ticket and the spec disagree, stop and report rather than guess.

## Acceptance criteria

- User stories 76-80 are satisfied at the action level.
- Action tests cover create, edit, and summary.
- The documented CLI invocation is shown to work against a running dev server (paste the command and output in your report).
- `pnpm test` and `pnpm typecheck` both exit 0 from `grill-room/`.

## Boundaries

- Work only inside `grill-room/`. Read `grill-room/AGENTS.md` and `grill-room/DEVELOPING.md` first, and use the framework's bundled, version-matched docs under `node_modules/@agent-native/core` rather than the public website.
- Behaviour is tested through actions against a real in-memory database with the fake interviewer; do not mock the store and never call the real Claude CLI from tests.
- `pnpm typecheck` prints production-deployment errors and a remediation prompt; this is a localhost-only app, so ignore them and change no deployment, auth, or environment configuration.
- Any MCP server goes through `mcp-cli` (for example `MCP_STRICT_ENV=false mcp-cli shadcn`, run from `grill-room/`), never a project `.mcp.json`.
- Never read, print, or commit `.env`.
