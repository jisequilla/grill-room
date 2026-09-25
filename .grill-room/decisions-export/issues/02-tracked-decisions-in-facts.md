# 02 Tracked decisions.md files in the project facts

Status: ready-for-agent
Blocked by: none
Suggested model: sonnet

## What to build

- The project's server facts gain the sorted, uncapped list of every `decisions.md` git tracks anywhere in the project, found with the read-only git commands already allowed. Untracked files are excluded.
- The collector takes an optional folder to exclude (project-relative); decisions.md files under it are left out. Passing the session's stored export folder is ticket 03's job.

## Builds on

The project facts collector, the read-only git wrapper and its allow-list, and the scout action that collects facts for a session. Confirm they exist first.

## How it will be judged

- Temp-git-repo tests: tracked decisions.md files at several depths are listed and sorted; an untracked one is not; files under the excluded folder are left out; a project with none gets an empty list.
- No new git subcommand is added to the allow-list.
- Verification: `pnpm exec vitest --run --maxWorkers=3` and `pnpm typecheck` from `grill-room/`.
