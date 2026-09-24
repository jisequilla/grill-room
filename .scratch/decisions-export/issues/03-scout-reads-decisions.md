# 03 The scout reads decisions.md as recorded, and honours Supersedes

Status: ready-for-agent
Blocked by: 02
Suggested model: sonnet

## What to build

- The scout prompt lists the facts' decisions.md files as recorded decision sources, beside the ADR folder, agent instructions and rules files it already names.
- The scout prompt says an entry carrying a Supersedes line overrides the source it quotes: propose the entry's decision, cited to its decisions.md line, and not the superseded statement.
- Plain sentences in the prompt's existing voice.

## Builds on

Ticket 02's facts field, and the scout prompt builder. Confirm both exist first.

## How it will be judged

- Adapter contract tests: the prompt names each listed file as a recorded source, says so when the list is empty, and carries the Supersedes rule.
- Verification: `pnpm exec vitest --run --maxWorkers=3` and `pnpm typecheck` from `grill-room/`.
