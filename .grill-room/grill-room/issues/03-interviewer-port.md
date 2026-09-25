# 03 Interviewer port with fake and real adapters

Status: ready-for-agent
Blocked by: 01
Suggested model: opus

## What to build

Build the interviewer port per the spec's section of that name: one narrow interface with four request kinds (propose round, review stale decisions, synthesize spec, break into tickets), each with a Zod output schema. Implement the scripted fake adapter (returns queued results, selected by configuration) and the real adapter, which spawns the Claude Code CLI headless once per turn with every tool disabled, the session's model, a JSON schema for structured output, and the previous conversation id for resume. The real adapter must clear the CLAUDECODE environment marker, fall back to a fresh conversation primed with the decision history when resume fails, report rate-limit failures distinctly from other errors, and report a missing or logged-out CLI clearly. Install a byte-identical copy of the upstream grilling skill text (source: repo-root .claude/skills/grilling/SKILL.md) inside the app and load it verbatim at runtime, followed by a short app-specific addendum. Verified working flags from the spike: `claude -p <prompt> --model <m> --output-format json --allowed-tools "" --json-schema <schema>`, continuation with `--resume <session_id>`; the result carries `structured_output` and `session_id`.

The spec at `.grill-room/grill-room/spec.md` is the source of truth; read the sections relevant to this ticket before starting. Where this ticket and the spec disagree, stop and report rather than guess.

## Acceptance criteria

- One contract test with the process spawn stubbed asserts: tools disabled, model passed, resume id passed when present, schema passed, CLAUDECODE cleared, malformed output and non-zero exit become typed errors.
- The fake adapter can be scripted with valid and invalid results and is selectable by configuration.
- The installed grilling skill text is byte-identical to the repo-root copy (a test asserts this).
- No test invokes the real CLI.
- `pnpm test` and `pnpm typecheck` both exit 0 from `grill-room/`.

## Boundaries

- Work only inside `grill-room/`. Read `grill-room/AGENTS.md` and `grill-room/DEVELOPING.md` first, and use the framework's bundled, version-matched docs under `node_modules/@agent-native/core` rather than the public website.
- Behaviour is tested through actions against a real in-memory database with the fake interviewer; do not mock the store and never call the real Claude CLI from tests.
- `pnpm typecheck` prints production-deployment errors and a remediation prompt; this is a localhost-only app, so ignore them and change no deployment, auth, or environment configuration.
- Any MCP server goes through `mcp-cli` (for example `MCP_STRICT_ENV=false mcp-cli shadcn`, run from `grill-room/`), never a project `.mcp.json`.
- Never read, print, or commit `.env`.
