# 01 Session-scoped scenarios in the fake interviewer

Status: ready-for-agent
Blocked by: gr-yts.3 (it adds a request builder; start after it merges so the new field reaches it)
Suggested model: opus

Build the scenario machinery (see ../spec.md, "Scenarios in the fake interviewer").

## What to build

- The session id on every interviewer request's context (`server/interviewer/types.ts`, `InterviewContext`), filled in by every caller that builds a request. The real adapter ignores it.
- A named scenario registry in `server/interviewer/fake.ts`: a scenario is `{ turns: ScriptedTurn[]; delayMs?: number }`. The default scenario is today's `cannedInterviewTurns()`.
- One queue per session in the fake, created from the session's chosen scenario on its first request, or from the default when none was chosen. A request whose kind does not match its session's next turn fails that request with a message naming the expected and actual kinds; other sessions are untouched. The optional delay applies before each answer.
- A test-only action `use-fake-scenario({ sessionId, scenario })`: succeeds only when the fake interviewer is selected (`GRILL_ROOM_INTERVIEWER=fake`), refused otherwise with code `fake-interviewer-only`; an unknown scenario name is refused with `unknown-scenario`.
- Action unit tests that call `scriptInterviewer` / `createFakeInterviewer` directly keep working unchanged.

## Builds on

`server/interviewer/fake.ts`, `server/interviewer/index.ts` (`getInterviewer`, `INTERVIEWER_ENV_VAR`), `e2e/smoke.spec.ts`. Confirm they exist first.

## Shares a boundary with

Ticket 02 adds scenarios to the registry; ticket 04 loads recordings as scenarios. Keep the registry a plain map from name to scenario.

## How it will be judged

- Module tests: two sessions on one fake each consume their own scenario; a mismatched request fails only its session; the default scenario serves sessions that chose none; the delay is honoured (use fake timers).
- Action tests: `use-fake-scenario` succeeds with the fake, is refused with `fake-interviewer-only` otherwise, and refuses an unknown name.
- `just e2e` still passes unchanged; `just dev-fake` still serves the canned interview.
- Verification: `pnpm exec vitest --run --maxWorkers=3`, `pnpm typecheck`, `just e2e`.
