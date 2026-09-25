# 02 HANDOFF.md per recipe, and the review section

Status: ready-for-agent
Blocked by: 01
Suggested model: sonnet

## What to build

The pure handoff renderer selects its "before delegating" and "delegation lifecycle" sections by recipe, and adds a fixed "Reviewing a ticket" section when review is on. Follow the spec's Implementation Decisions exactly:
- **Pull request:** a draft pull request; a draft is never merged.
- **Local merge:** commit on main before delegating; on approval, the branch diff is re-verified and merged locally; the verdict is recorded per the project's tracker.
- **Review on:** the reviewer's inputs, what to try to break, the verdict per recipe, the same-branch fix loop and the two-round cap.
- **Review off:** no review section, and no review step anywhere in the lifecycle text.

This repository's `.claude/rules/worktrees.md` is the working model for the pull-request text with review on.

## Builds on

Ticket 01's fields, and the handoff renderer's lifecycle and before-delegating sections. Confirm they exist first.

## How it will be judged

- Renderer tests pin the exact HANDOFF.md text for all four combinations of recipe and review switch.
- Verification: `pnpm exec vitest --run --maxWorkers=3` and `pnpm typecheck` from `grill-room/`.
