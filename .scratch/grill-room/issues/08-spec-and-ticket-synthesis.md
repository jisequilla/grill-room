# 08 Spec synthesis and ticket breakdown

Status: ready-for-agent
Blocked by: 03, 07
Suggested model: sonnet

## What to build

Implement spec synthesis and ticket breakdown actions through the port, available only for confirmed sessions. The spec request instructs the interviewer to use the upstream to-spec template sections and rules verbatim (source: repo-root .claude/skills/to-spec/SKILL.md, template part only; no repository exploration, no seams check). Out-of-scope dispositions feed Out of Scope; open-question dispositions feed Further Notes. Tickets are validated: blocked-by links reference existing tickets and are acyclic. Both can be regenerated; a currency marker shows whether they match the tree.

The spec at `.scratch/grill-room/spec.md` is the source of truth; read the sections relevant to this ticket before starting. Where this ticket and the spec disagree, stop and report rather than guess.

## Acceptance criteria

- User stories 56-61, 63-66, 68, 69 are satisfied at the action level.
- Action tests cover refusal for unconfirmed sessions, disposition routing into the request, ticket link validation, regeneration, and the out-of-date marker.
- `pnpm test` and `pnpm typecheck` both exit 0 from `grill-room/`.

## Boundaries

- Work only inside `grill-room/`. Read `grill-room/AGENTS.md` and `grill-room/DEVELOPING.md` first, and use the framework's bundled, version-matched docs under `node_modules/@agent-native/core` rather than the public website.
- Behaviour is tested through actions against a real in-memory database with the fake interviewer; do not mock the store and never call the real Claude CLI from tests.
- `pnpm typecheck` prints production-deployment errors and a remediation prompt; this is a localhost-only app, so ignore them and change no deployment, auth, or environment configuration.
- Any MCP server goes through `mcp-cli` (for example `MCP_STRICT_ENV=false mcp-cli shadcn`, run from `grill-room/`), never a project `.mcp.json`.
- Never read, print, or commit `.env`.
