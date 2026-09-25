# 01 intent.md in the export plan

Status: ready-for-agent
Blocked by: none
Suggested model: sonnet

## What to build

- The export's pure planning step plans an `intent.md` at the bundle root, beside the spec and decisions.md, rendered from stored data with no model call: the session's title and idea, the stored readiness judgment and the session's scout report. Content and fallbacks exactly as the spec's "intent.md" section says.
- The bundle layer loads the readiness judgment, the scout report and the project's current HEAD (for the "project has changed since" note) and passes them to the planner.

## Builds on

The pure export planner and its renderers (spec, tickets, decisions.md), the export bundle, the stored readiness judgment and its "judged idea equals current idea" rule, the scout report store and its staleness, and the project facts' HEAD commit. Confirm they exist first.

## How it will be judged

- Export plan tests asserting intent.md's exact text for: a current readiness judgment and a current scout report; no judgment; a judgment made for an earlier idea; a stale scout report; no scout report. Repo evidence shows its citation; user evidence does not.
- An export-session test shows intent.md written and listed in the manifest.
- Verification: `pnpm exec vitest --run --maxWorkers=3` and `pnpm typecheck` from `grill-room/`.
