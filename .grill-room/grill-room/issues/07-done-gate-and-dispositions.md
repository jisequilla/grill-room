# 07 Done gate and dispositions

Status: ready-for-agent
Blocked by: 05
Suggested model: sonnet

## What to build

Implement finishing per the spec: the interviewer may propose done only when the app itself verifies the frontier is empty; the proposal carries a summary of settled decisions. Confirmation is refused while any decision is unknown, deferred, pushed back, or prototype flagged; each must get a real answer or a disposition (out of scope, or named open question). An action lists the loose ends blocking confirmation. Confirming moves the session to confirmed. Reopening a decision in a confirmed session returns it to interviewing and marks spec and tickets out of date.

The spec at `.grill-room/grill-room/spec.md` is the source of truth; read the sections relevant to this ticket before starting. Where this ticket and the spec disagree, stop and report rather than guess.

## Acceptance criteria

- User stories 50-55 are satisfied at the action level.
- Action tests cover a premature done proposal being rejected, confirmation refused with loose ends, both dispositions, and the confirmed-then-reopened path.
- `pnpm test` and `pnpm typecheck` both exit 0 from `grill-room/`.

## Boundaries

- Work only inside `grill-room/`. Read `grill-room/AGENTS.md` and `grill-room/DEVELOPING.md` first, and use the framework's bundled, version-matched docs under `node_modules/@agent-native/core` rather than the public website.
- Behaviour is tested through actions against a real in-memory database with the fake interviewer; do not mock the store and never call the real Claude CLI from tests.
- `pnpm typecheck` prints production-deployment errors and a remediation prompt; this is a localhost-only app, so ignore them and change no deployment, auth, or environment configuration.
- Any MCP server goes through `mcp-cli` (for example `MCP_STRICT_ENV=false mcp-cli shadcn`, run from `grill-room/`), never a project `.mcp.json`.
- Never read, print, or commit `.env`.
