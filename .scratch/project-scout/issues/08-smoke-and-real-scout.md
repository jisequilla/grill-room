# 08 Browser smoke test and a real scout run

Status: ready-for-agent
Blocked by: 07
Suggested model: sonnet

## What to build

- Extend the browser smoke test (`e2e/`) with the fake interviewer scripted to return a scout report: the panel shows it, keeping a proposal puts a repo decision in the tree, and the first round never asks it.
- A real scout run with the real CLI against poc-grill-me itself (registered as a project), on a throwaway session. Paste the stored report in the PR.

## How it will be judged

- `just e2e` passes.
- The real report cites only paths that exist, proposes decisions the repo actually holds (the main session checks them against the code), and its turn record shows sonnet.
- Verification: `pnpm test`, `pnpm typecheck` and `just e2e` from the repo.
