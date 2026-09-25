# 01 App shell, chat removal, and test harness

Status: ready-for-agent
Blocked by: none
Suggested model: opus

## What to build

Remove the template's chat surfaces from navigation and routes (the framework's embedded chat agent is not used). Add the three empty main surfaces as routes: session list (the landing page), session workspace, session output. Set up the test harness every later ticket depends on: a helper that gives each test a fresh in-memory instance of the embedded database with the app's schema applied, and a way to invoke an action's run function against it. Prove the harness with one trivial action test. Remove the stock hello action.

The spec at `.grill-room/grill-room/spec.md` is the source of truth; read the sections relevant to this ticket before starting. Where this ticket and the spec disagree, stop and report rather than guess.

## Acceptance criteria

- The app starts with `pnpm dev` and lands on an empty session list; no chat UI is reachable from navigation.
- A documented test helper provides an isolated in-memory database per test and is used by at least one passing action test.
- Framework surfaces the app still needs (settings, database viewer) keep working.
- `pnpm test` and `pnpm typecheck` both exit 0 from `grill-room/`.

## Boundaries

- Work only inside `grill-room/`. Read `grill-room/AGENTS.md` and `grill-room/DEVELOPING.md` first, and use the framework's bundled, version-matched docs under `node_modules/@agent-native/core` rather than the public website.
- Behaviour is tested through actions against a real in-memory database with the fake interviewer; do not mock the store and never call the real Claude CLI from tests.
- `pnpm typecheck` prints production-deployment errors and a remediation prompt; this is a localhost-only app, so ignore them and change no deployment, auth, or environment configuration.
- Any MCP server goes through `mcp-cli` (for example `MCP_STRICT_ENV=false mcp-cli shadcn`, run from `grill-room/`), never a project `.mcp.json`.
- Never read, print, or commit `.env`.
