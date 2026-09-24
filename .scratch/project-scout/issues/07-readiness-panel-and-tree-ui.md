# 07 Scout report in the readiness panel, repo marker in the tree

Status: ready-for-agent
Blocked by: 04, 05, 06
Suggested model: sonnet

## What to build

- The readiness panel (`app/components/workspace/readiness-panel.tsx`) shows the scout report: server facts, current state grouped built / partial / gap with citations, proposed decisions with source, citation, reason and keep / drop controls, the commit and model, a stale badge, a re-scout control, and the scout turn's attempt log (turn-visibility component). Evidence items show their source.
- The panel stays reachable after the first round when the session has a project.
- Repo decisions in the design tree (`app/components/workspace/design-tree.tsx`) carry a repo marker with recorded / inferred and the citation.
- Use the browser to check the screens (read `grill-room/DESIGN.md` first); screenshots in the PR.

## How it will be judged

- Component tests (prior art `readiness-panel.test.tsx`): the report renders every group, keep and drop call their actions, stale shows the badge, evidence shows its source; the tree shows the marker.
- Verification: `pnpm test` and `pnpm typecheck` from `grill-room/`.
