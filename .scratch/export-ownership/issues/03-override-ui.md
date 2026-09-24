# 03 Edited files in the export preview

Status: ready-for-agent
Blocked by: 02
Suggested model: sonnet

## What to build

- The export preview marks each edited file it would write or remove, with an "Overwrite anyway" or "Remove anyway" checkbox, unticked by default. Export passes the ticked paths as the override list.
- The export result lists kept files alongside written and removed ones.
- Copy through the app's i18n strings, in the existing export section's style.

## Builds on

Ticket 02's preview and export action fields, and the export section component. Confirm they exist first.

## How it will be judged

- Component tests in the repo's existing style for the edited marker and the kept list.
- The agent checks its own screens with `agent-browser` on its own server (free port, `AUTH_DISABLED`, fake interviewer, isolated database). The browser scenario itself is ticket 04.
- Verification: `pnpm exec vitest --run --maxWorkers=3`, `pnpm typecheck`, and `just e2e` from the repo root still passing.
