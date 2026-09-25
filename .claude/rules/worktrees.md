# Delegated Work in Worktrees

Every delegated ticket runs in its own Agent-tool worktree (`isolation: "worktree"`) and reaches `main` only through a pull request that the main session has reviewed and verified.

## Why pull requests

The Agent tool creates each worktree from `origin/main`, not from local `main`. Merging on GitHub keeps `origin/main` current, so every new worktree starts from the latest merged work. A ticket merged only locally is invisible to the next worktree, which is how a dependent ticket once started without the helper it was built on.

## Before launching

- Local `main` holds nothing unpushed. Push it first if it does, so the worktree's base includes it.
- The delegation prompt names the files the ticket builds on, and the agent's first step is to confirm they exist. If they do not, it stops and reports rather than recreating them.

## The subagent

- Commits only on its worktree branch; runs no git command outside its worktree and never touches `main`.
- Runs the verification the prompt names (for grill-room: `pnpm test` and `pnpm typecheck` from `grill-room/`, plus `just e2e` when the ticket touches the UI).
- Pushes its branch and opens a pull request against `main` with `gh pr create`. The title names the bead (`gr-xxx: <summary>`); the body carries the ticket path, files changed, the exact verification output, and anything the prompt left ambiguous. `gh` must be on the `jisequilla` account.
- Reports the PR number, then stops. It never merges.
- Stops only processes it started, by the PID it recorded when starting them. It never finds processes by name (`pgrep`, `pkill`, `killall`) or runs `just stop`/`just restart`: the user's own dev server runs the same command line and has been killed that way.

## Browser checks

A ticket that changes what the user sees is checked in two ways, and the delegation prompt names both.

- The agent looks at its own screens with `agent-browser`, against its worktree's own server on a free port with `AUTH_DISABLED`, the fake interviewer and an isolated `DATABASE_URL`, never the user's server or database. It never uses the claude-in-chrome tools, which drive the user's own Chrome.
- The agent adds or extends a Playwright scenario under `grill-room/e2e/` for the behaviour it built, so `just e2e` guards it from then on. An exploratory check that finds a defect becomes a scenario.

## The main session

- Reads the PR diff (`gh pr diff <n>`) against the ticket's file boundaries.
- Re-runs the verification itself in the worktree, plus any browser check the ticket calls for. A subagent's report is a claim, not evidence.
- Sends failures back to the same agent on its branch; the fix lands as a new commit on the same PR.
- Merges only verified work: `gh pr merge <n> --merge --delete-branch`, then `git pull` on local `main` and re-runs the suite on the merged result before closing the bead. The close comment names the PR.
- Removes merged worktrees with `just prune-worktrees`.
