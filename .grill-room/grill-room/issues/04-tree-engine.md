# 04 Tree engine: derived states, proposal validation, round submission

Status: ready-for-agent
Blocked by: 02, 03
Suggested model: opus

## What to build

Implement the core of the spec's 'Tree state is derived' section through actions. Derived states (settled, frontier, blocked, stale) are computed by the app from answers and dependency links, never stored from the interviewer. Actions: start interview / request next round (calls the port, validates the proposal, stores decisions and the round), get tree (decisions with derived state and dependencies), get current round, save draft answer, submit round (accept recommendation or own answer only in this ticket). Proposal validation rejects the whole proposal when a question is not on the frontier, a dependency link dangles, or links form a cycle; the interviewer is re-asked with the reason up to a bounded number of times, then the user gets an error. The interviewer may add blocked decisions that appear in the tree but not in the round. One-at-a-time mode yields single-decision rounds. Round history is retrievable.

The spec at `.grill-room/grill-room/spec.md` is the source of truth; read the sections relevant to this ticket before starting. Where this ticket and the spec disagree, stop and report rather than guess.

## Acceptance criteria

- User stories 12-18, 21-24, 35-37, 42, 43 are satisfied at the action level.
- Action tests script the fake interviewer with: valid rounds, a frontier violation, a dangling link, a cycle, schema-invalid output, and exhaustion of the retry bound.
- Draft answers persist across calls (story 9).
- `pnpm test` and `pnpm typecheck` both exit 0 from `grill-room/`.

## Boundaries

- Work only inside `grill-room/`. Read `grill-room/AGENTS.md` and `grill-room/DEVELOPING.md` first, and use the framework's bundled, version-matched docs under `node_modules/@agent-native/core` rather than the public website.
- Behaviour is tested through actions against a real in-memory database with the fake interviewer; do not mock the store and never call the real Claude CLI from tests.
- `pnpm typecheck` prints production-deployment errors and a remediation prompt; this is a localhost-only app, so ignore them and change no deployment, auth, or environment configuration.
- Any MCP server goes through `mcp-cli` (for example `MCP_STRICT_ENV=false mcp-cli shadcn`, run from `grill-room/`), never a project `.mcp.json`.
- Never read, print, or commit `.env`.
