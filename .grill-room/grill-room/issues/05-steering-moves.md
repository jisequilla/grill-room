# 05 Steering moves and user-added decisions

Status: ready-for-agent
Blocked by: 04
Suggested model: sonnet

## What to build

Extend round answering with the steering moves: unknown (I don't know), push back with a reason, defer, prototype flag (paused until the user records what the prototype taught them, which then becomes a real answer), and adding a user-authored decision that the interviewer places in the tree. None of these count as settled, so dependents stay blocked. A push back is sent to the interviewer with its reason; a response that re-asks the same decision unchanged is rejected.

The spec at `.grill-room/grill-room/spec.md` is the source of truth; read the sections relevant to this ticket before starting. Where this ticket and the spec disagree, stop and report rather than guess.

## Acceptance criteria

- User stories 25-34 and 38 are satisfied at the action level.
- Action tests cover each move, the blocking of dependents, the unchanged re-ask rejection, and resolving a prototype flag.
- `pnpm test` and `pnpm typecheck` both exit 0 from `grill-room/`.

## Boundaries

- Work only inside `grill-room/`. Read `grill-room/AGENTS.md` and `grill-room/DEVELOPING.md` first, and use the framework's bundled, version-matched docs under `node_modules/@agent-native/core` rather than the public website.
- Behaviour is tested through actions against a real in-memory database with the fake interviewer; do not mock the store and never call the real Claude CLI from tests.
- `pnpm typecheck` prints production-deployment errors and a remediation prompt; this is a localhost-only app, so ignore them and change no deployment, auth, or environment configuration.
- Any MCP server goes through `mcp-cli` (for example `MCP_STRICT_ENV=false mcp-cli shadcn`, run from `grill-room/`), never a project `.mcp.json`.
- Never read, print, or commit `.env`.
