# 01 decisions.md in the export plan

Status: ready-for-agent
Blocked by: none
Suggested model: opus

## What to build

- The export's pure planning step plans a `decisions.md` at the bundle root, beside the spec, rendered from the session's tree with no model call. Content, layout, labels, dependency forms and ordering are exactly as the spec's "What decisions.md holds", "Entry layout" and "Ordering and planning" sections say.
- Planned only when the Decisions or Out of scope section has at least one item.
- Whatever the planning step needs from the tree and isn't already given it (answer kind, offered choices and their rationales, disposition target and note, repo source, citation and statement, dependencies, reopened status) is added to its input from data already stored. No schema change.
- The bundle layer needs no special case: confirm that preview, containment, write, manifest and removal handle the new file generically, and cover that with bundle tests.

## Builds on

The pure export planner and its spec/ticket renderers, the export bundle (preview, write, manifest removals), the tree module (states, settling answer kinds, loose-end kinds), the repo-decision keep/drop/reopen actions, and the disposition action. Confirm they exist first.

## How it will be judged

- Export plan tests covering every case in the spec's Testing Decisions "Export plan" list, asserting on the planned file's exact text.
- Bundle tests: decisions.md in the preview, written and in the manifest; a re-export that no longer plans it removes it and nothing else.
- Verification: `pnpm exec vitest --run --maxWorkers=3` and `pnpm typecheck` from `grill-room/`.
