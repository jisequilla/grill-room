# 03 Recipe and review in the project settings

Status: ready-for-agent
Blocked by: 01
Suggested model: sonnet

## What to build

Wherever project settings are shown and edited, add:
- the delivery recipe, as a choice between pull request and local merge;
- the adversarial review switch.

Both save through `update-project`. All copy goes through the app's i18n strings.

## Builds on

Ticket 01's fields and the existing project settings UI. Confirm they exist first.

## How it will be judged

- Component tests in the repo's existing style.
- A browser check with `agent-browser` on the agent's own server.
- A Playwright step, added to an existing spec that touches project settings or to the smoke test, that changes the recipe and sees it persisted.
- Verification: `pnpm exec vitest --run --maxWorkers=3`, `pnpm typecheck`, and `just e2e` from the repo root.
