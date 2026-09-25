# 06 Reopening decisions and stale review

Status: ready-for-agent
Blocked by: 04
Suggested model: opus

## What to build

Implement reopening per the spec: reopening a settled decision moves its answer to history, clears settled state, and marks all transitive dependents stale. The next turn is a stale review request to the port; each stale decision comes back as reconfirm (settled again with its old answer) or re-ask (rejoins the tree unsettled with an updated question). History of all previous answers is kept and retrievable. Reopening is allowed in any session state.

The spec at `.grill-room/grill-room/spec.md` is the source of truth; read the sections relevant to this ticket before starting. Where this ticket and the spec disagree, stop and report rather than guess.

## Acceptance criteria

- User stories 44-49 are satisfied at the action level.
- Action tests cover transitive staleness across at least three levels, mixed reconfirm/re-ask results, and history contents.
- `pnpm test` and `pnpm typecheck` both exit 0 from `grill-room/`.

## Boundaries

- Work only inside `grill-room/`. Read `grill-room/AGENTS.md` and `grill-room/DEVELOPING.md` first, and use the framework's bundled, version-matched docs under `node_modules/@agent-native/core` rather than the public website.
- Behaviour is tested through actions against a real in-memory database with the fake interviewer; do not mock the store and never call the real Claude CLI from tests.
- `pnpm typecheck` prints production-deployment errors and a remediation prompt; this is a localhost-only app, so ignore them and change no deployment, auth, or environment configuration.
- Any MCP server goes through `mcp-cli` (for example `MCP_STRICT_ENV=false mcp-cli shadcn`, run from `grill-room/`), never a project `.mcp.json`.
- Never read, print, or commit `.env`.
