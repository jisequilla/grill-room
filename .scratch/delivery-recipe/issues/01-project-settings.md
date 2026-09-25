# 01 Delivery recipe and review switch on the project

Status: ready-for-agent
Blocked by: none
Suggested model: sonnet

## What to build

- Two additive project columns: `deliveryRecipe` (`pull-request` | `local-merge`) and `adversarialReview` (boolean). Existing rows migrate to `pull-request` and `true`.
- Registration sets the recipe from the repository's remotes through the read-only git wrapper when none is given: any remote gives `pull-request`, none gives `local-merge`. An explicit value wins.
- `update-project` can change both fields. Both appear in the project read actions.
- Both fields join the handoff fingerprint, so changing either marks an existing handoff stale.

## Builds on

The projects table and its migrations, `register-project`, `update-project`, the read-only git wrapper and its allow-list (`remote -v` is already allowed), and the handoff fingerprint. Confirm they exist first.

## How it will be judged

- Temp-git-repo action tests:
  - registration with a remote defaults to pull request;
  - registration without a remote defaults to local merge;
  - an explicit value wins;
  - update changes both fields;
  - a migrated row reads as pull request with review on.
- A handoff test shows the handoff going stale after either field changes.
- Verification: `pnpm exec vitest --run --maxWorkers=3` and `pnpm typecheck` from `grill-room/`.
