# 12 UI: session workspace (cards, tree, history)

Status: ready-for-agent
Blocked by: 05, 06, 11
Suggested model: opus

## What to build

Build the session workspace: round cards (recommended answer, offered choices, accept, own answer, and every steering move), answered/unanswered indication, submit round, working and error-with-retry states (rate limit shown distinctly), answering-mode switch, round history, and the design tree as an indented outline with state badges whose selection shows the decision's question, answer and history. Reopen from the tree. Loose-ends list and the done proposal summary with confirm. Live updates via the database sync hook.

The spec at `.grill-room/grill-room/spec.md` is the source of truth; read the sections relevant to this ticket before starting. Where this ticket and the spec disagree, stop and report rather than guess.

## Acceptance criteria

- User stories 12-24, 25-34, 35-41, 44-55 work in the browser against the fake interviewer.
- Typecheck passes; existing component kit only.
- `pnpm test` and `pnpm typecheck` both exit 0 from `grill-room/`.

## Boundaries

- Work only inside `grill-room/`. Read `grill-room/AGENTS.md` and `grill-room/DEVELOPING.md` first, and use the framework's bundled, version-matched docs under `node_modules/@agent-native/core` rather than the public website.
- Behaviour is tested through actions against a real in-memory database with the fake interviewer; do not mock the store and never call the real Claude CLI from tests.
- `pnpm typecheck` prints production-deployment errors and a remediation prompt; this is a localhost-only app, so ignore them and change no deployment, auth, or environment configuration.
- Any MCP server goes through `mcp-cli` (for example `MCP_STRICT_ENV=false mcp-cli shadcn`, run from `grill-room/`), never a project `.mcp.json`.
- Never read, print, or commit `.env`.
