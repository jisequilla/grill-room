# 06 Re-scout and drift

Status: ready-for-agent
Blocked by: 05
Suggested model: sonnet

## What to build

- `scout-project` (ticket 03) on a session that already has a report sends the previous report's kept and proposed decisions, and applies the result: a kept decision reported `changed` or `removed` is reopened through the existing reopen (dependents go stale); a changed one gets the new statement as its recommended answer; `unchanged` ones are untouched; new proposals await keep or drop. The new report replaces the old one.
- Allowed after rounds exist.
- Which decisions a re-run carries: a kept decision lives in the design tree as a repo decision, not only in a report, so the previous decisions sent to the scout are every repo decision in the tree (disposition `kept`) plus the latest report's proposals that were dropped or are still undecided. A decision kept two re-runs ago must still be sent, even if the latest report did not propose it again.
- Dispositions carry forward: in the new report, a decision reported `unchanged` keeps its previous disposition (kept or dropped); only new proposals start `undecided`. The report is one row per session and a re-run replaces it (`server/scout-report.ts`), so the carry-forward happens when the new row is stored.

## How it will be judged

- Action tests with a temporary git repo: after a commit, a re-run reporting one kept decision changed, one removed and one unchanged reopens the first two (with dependents stale) and leaves the third settled; a new proposal awaits keep or drop; a re-run after rounds exist works.
- Verification: `pnpm test` and `pnpm typecheck` from `grill-room/`.
