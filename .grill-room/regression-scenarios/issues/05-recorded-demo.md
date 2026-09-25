# 05 A recorded demo of the whole app

Status: ready-for-agent
Blocked by: 03, 04, and the scout's UI (gr-yts.7) so the scout report is on screen
Suggested model: sonnet

## What to build

- The operator chose the demo: a Grill Room feature grilled against this repository, so the scout grounds the idea on screen. The idea: "Export a session's decisions as a decisions.md beside the spec, each with its origin (user, interviewer, recorded or inferred from the repo) and citation." The session is registered to poc-grill-me as its project and recorded once with `GRILL_ROOM_RECORD_TURNS` set, covering the scout, readiness, rounds, a reopen with its stale review, done, spec and tickets. The recording is reviewed and committed as a scenario fixture. The demo test registers a project whose files match the recorded citations.
- `e2e/demo.spec.ts` replays it and walks the whole app: idea, readiness, rounds, a reopen with its stale review, done, spec, tickets and export, pausing between steps so each is visible. It is excluded from `just e2e`.
- A `just demo` recipe that runs only the demo with Playwright video on, compresses the result to a small webm (target under 5 MB), and writes it to `docs/media/demo.webm`.
- A README section linking the video, with one line on how to regenerate it.

## How it will be judged

- `just demo` produces `docs/media/demo.webm` under 5 MB; the main session watches it end to end.
- `just e2e` does not run the demo and still passes.
- Verification: `pnpm exec vitest --run --maxWorkers=3`, `pnpm typecheck`, `just e2e`, `just demo`.
