# 04 Readiness with a project: scout first, sourced evidence

Status: ready-for-agent
Blocked by: 03
Suggested model: sonnet

## What to build

- `assess-readiness` (`actions/assess-readiness.ts`): when the session has a project and no current scout report, run the scout (ticket 03) first, then the judge; two turns, two turn records. Without a project, unchanged.
- The judge's request carries the current report. Evidence items become `{ text, source: idea|repo, citation? }` (`server/interviewer/schemas.ts`); a repo item must carry a citation, checked with ticket 03's citation function in `reasonsToRefuseReadiness` (`server/readiness.ts`). Update the judge prompt accordingly.
- The stored judgment records which report it read, and is stale when that report is stale as well as when the idea changed.

## Shares a boundary with

The readiness panel (ticket 07) renders evidence sources. Existing stored judgments have plain-string evidence: read them as source `idea` rather than failing.

## How it will be judged

- Action tests: with a project, readiness runs scout then judge; with a current report, only the judge runs; without a project, the existing readiness tests pass unchanged; repo evidence with a bad citation is refused; a judgment goes stale when its report does; an old stored judgment still reads.
- Verification: `pnpm test` and `pnpm typecheck` from `grill-room/`.
