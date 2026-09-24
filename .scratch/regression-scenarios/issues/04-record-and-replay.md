# 04 Record real interviewer answers and replay them

Status: ready-for-agent
Blocked by: 01
Suggested model: sonnet

## What to build

- Recording mode in the real adapter (`server/interviewer/claude-cli.ts`): when `GRILL_ROOM_RECORD_TURNS` names a file, each accepted model result is appended to it as `{ kind, result }` (one JSON object per line). Off when the variable is unset.
- A loader that turns a recording file into a scenario for the registry, validating each entry against its kind's result schema and refusing the whole file on the first mismatch, with the line number.

## How it will be judged

- Contract test (spawn stubbed): with the variable set, two turns append two lines with the right kinds; unset, nothing is written.
- Loader tests: a valid recording becomes a scenario whose turns replay in order; a line that fails its schema refuses the file and names the line.
- Verification: `pnpm exec vitest --run --maxWorkers=3`, `pnpm typecheck`.
