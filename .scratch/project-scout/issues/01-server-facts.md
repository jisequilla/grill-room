# 01 Collect the project's server facts

Status: ready-for-agent
Blocked by: none
Suggested model: sonnet

Build the deterministic half of grounding (see ../spec.md, "Server facts").

## What to build

- A server module that, given a registered project's root, returns its facts: HEAD commit and branch, remotes, whether the working tree is dirty, the last ten commit subjects, and which of these exist at the root: `CLAUDE.md` / `AGENTS.md`, a decisions folder (`docs/decisions`, `docs/adr`, `adr`), `.claude/rules/`.
- Use the existing read-only git helper (`server/git.ts`, `runGit`) and plain file checks. No model, no writes.
- A root that is no longer a git repository returns a refusal with its own code (`not-a-repo`), in the style of `server/project-refusal.ts`.

## Builds on

`server/git.ts`, `server/projects.ts` (`resolveGitRoot`). Confirm both exist before starting.

## Shares a boundary with

Ticket 03 stores these facts in the report and passes them to the scout; keep the returned shape a plain serializable object.

## How it will be judged

- Tests build a real temporary git repository (as `server/visibility.test.ts` and `server/projects.test.ts` do): commits, a remote, a dirty file, the three optional paths present and absent. Every fact matches the fixture.
- A folder that is not a repository is refused with `not-a-repo`.
- Verification: `pnpm test` and `pnpm typecheck` from `grill-room/`.
