# 05 Repo decisions in the design tree, project context for every turn

Status: ready-for-agent
Blocked by: 03
Suggested model: opus

## What to build

- `introducedBy` gains `repo` and the answer kinds gain one for a decision established by the repo (`shared/session-constants.ts`, `server/db/schema.ts`, additive migration). A repo decision carries source (recorded/inferred), citation, report link, and after a reopen the repo statement it replaced.
- `keep-repo-decision` and `drop-repo-decision` actions: allowed while interviewing with no turn working. Keep adds a settled repo decision with the statement as its answer; drop only records the drop on the report.
- The tree engine (`server/tree.ts`) treats a repo decision as settled; the existing rules keep it off the frontier. Reopen (`actions/reopen-decision.ts`) works on it unchanged and marks dependents stale.
- Every interviewer turn's request carries the project context: the current report's current state and dropped proposals, marked stale with its commit when stale. Repo decisions reach the interviewer in the decision snapshot with origin and citation (`server/interviewer/types.ts`, `server/turn.ts` snapshot, prompt instructions: repo decisions are the project's constraints; new decisions may depend on them).
- Spec synthesis receives the repo decisions reopened in the interview, each with the statement it replaced, and the prompt states each as a deliberate change.

## Shares a boundary with

The stored report (`server/scout-report.ts`, ticket 03) holds `dispositions: Record<key, "undecided" | "kept" | "dropped">` in `dispositions_json`, with no helper to write it yet: add one there and use it from keep and drop.


This is the ticket most likely to leave a seam: ticket 03's report keys and keep/drop state, ticket 06's reopen-on-change, and every turn's request builder. Keep the project-context builder in one function used by all turn kinds.

## How it will be judged

- Action tests: keep adds a settled repo decision the frontier never offers and that a proposed round cannot re-ask; drop adds nothing and the dropped proposal appears in the next turn's context; reopening a repo decision stales its dependents; an interviewer-proposed decision may depend on a repo decision; every turn kind's request (assert through the fake's recorded requests) carries the project context; spec synthesis receives reopened repo decisions.
- Existing tree and turn tests pass unchanged.
- Verification: `pnpm test` and `pnpm typecheck` from `grill-room/`.
