# 09 Export to the local-markdown tracker layout

Status: ready-for-agent
Blocked by: 08
Suggested model: sonnet

## What to build

Implement the export action per the spec: into the session's target folder, write a feature folder named from the session slug containing the spec as one file and one numbered file per ticket with Status and Blocked-by lines, matching the layout described in repo-root docs/agents/issue-tracker.md. Report the files written; refuse missing or unwritable targets with a clear error; require explicit confirmation before overwriting existing files. Setting the target folder is a session action.

The spec at `.grill-room/grill-room/spec.md` is the source of truth; read the sections relevant to this ticket before starting. Where this ticket and the spec disagree, stop and report rather than guess.

## Acceptance criteria

- User stories 70-75 are satisfied at the action level.
- Action tests export into a temporary directory and assert on file names and contents, the overwrite guard, and both error cases.
- `pnpm test` and `pnpm typecheck` both exit 0 from `grill-room/`.

## Boundaries

- Work only inside `grill-room/`. Read `grill-room/AGENTS.md` and `grill-room/DEVELOPING.md` first, and use the framework's bundled, version-matched docs under `node_modules/@agent-native/core` rather than the public website.
- Behaviour is tested through actions against a real in-memory database with the fake interviewer; do not mock the store and never call the real Claude CLI from tests.
- `pnpm typecheck` prints production-deployment errors and a remediation prompt; this is a localhost-only app, so ignore them and change no deployment, auth, or environment configuration.
- Any MCP server goes through `mcp-cli` (for example `MCP_STRICT_ENV=false mcp-cli shadcn`, run from `grill-room/`), never a project `.mcp.json`.
- Never read, print, or commit `.env`.
