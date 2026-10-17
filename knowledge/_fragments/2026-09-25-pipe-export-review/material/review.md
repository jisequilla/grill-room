# Grill Room export review

The original review by an external tester (Pipe), as received. `pipe-export-review.md` maps its items to beads.

Sep 25, 2026

The handoff bundle's decision trail and delegation briefs are strong. Fix the export first: it presents superseded decisions as live, states repo facts it never checked, and marks tickets ready while the facts they depend on are still open. Findings come from one real bundle for a two-sided services marketplace: 23 tickets, 23 briefs, 13 waves, exported to a greenfield repository.

## What to keep

These parts worked well and should survive any rework.

- **Decision provenance.** Each decision in decisions.md records the interviewer's case with its cost, its origin (accepted recommendation, another offered option, own answer) and a Depends on: list of other decisions. A reviewer can see why a choice was made, not just what it was.
- **Testable rules in the spec.** Money rules come with exact boundaries (refund tiers at 14 days and 72 hours, a 72-hour payout hold) and the testing section lists the boundary cases to cover. The out-of-scope list is specific.
- **Facts kept apart from risks.** The spec's closing notes separate facts to confirm before building from risks accepted on purpose.
- **Build / Judged by tickets.** Acceptance criteria describe observable behaviour. One example: two state changes to the same booking at the same time cannot both succeed.
- **Safe delegation briefs.** Each brief keeps the agent inside one worktree, stops it if the files it builds on are missing, allows only a draft PR, and ends with report-then-stop.
- **Review protocol.** A second, fresh-context reviewer sees the spec, ticket, brief and diff, never the builder's report. The line "a subagent's report is a claim, not evidence" sets the right standard.
- **Build records.** Logging model, first-attempt pass, escalation and what the brief was missing gives the engine a real feedback loop.

## Export defects

These are bugs in how the bundle is written, not in the interview. Fixing them once in the exporter improves every future bundle. Ordered by impact.

| # | Defect | Evidence in the bundle | Suggested fix |
|---|---|---|---|
| 1 | Superseded decisions exported as live | A liability decision reads "Wait until the first service and vetting depth are settled", next to a later one with the real answer. A payout hold of "48–72h" (note: "wait until dispute handling is settled") sits next to a later "72h". Cancellation appears twice. | Add Superseded by: #anchor to replaced nodes, or fold them into the history of the final one. Never export a deferral as a decision. |
| 2 | Raw answers pass through unedited | The first decision keeps the user's free text verbatim, typos included, plus an instruction addressed to the AI assistant. Build agents read this file. | Split each free-text answer into the decision and any operator directives. Put directives in a separate operator-notes section that agents are told not to act on. |
| 3 | Readiness verdict never re-run | intent.md still says Verdict: not-ready while the spec and all 23 tickets say ready-for-agent. | Re-run the readiness check after the grill session, or mark intent.md as the pre-interview snapshot. |
| 4 | Repo facts stated but never checked | The export file has scoutCommit: null and headCommit: null. HANDOFF.md still says the bundle folder is tracked by git, and each brief says "the bundle is committed in this repository". The target repo had no commits, and a common .scratch/* ignore rule hid the bundle. | Scan the repo before export. When it is empty, say "greenfield: ticket 01 establishes the verify command". Check that the bundle path is not git-ignored. |
| 5 | Verify command assumed | Every brief uses pnpm test in a repo with no package.json. Tickets after 01 can pass a verify step that tests nothing. | Name the command as "set by ticket 01" and make ticket 01's acceptance criteria include it. |
| 6 | Brief text duplicates ticket text | Each brief embeds its ticket word for word, so a re-export of one can drift from the other. The sha256 list helps detect drift but not prevent it. | Link the ticket from the brief, or regenerate briefs whenever a ticket changes. |
| 7 | Build-record commands repeated | 23 near-identical command lines, one per ticket. | One template line with `<n>` as the placeholder. |

## Interview depth gaps

These come from what the grill session did not ask, so they need changes to the interview, not the exporter.

- **The hardest context is left blank.** All 23 briefs leave the file-boundaries and codebase-facts slots empty. For a greenfield repo the engine could fill ticket 01's boundaries and propose a module-to-path map for the rest.
- **Open choices are passed to the builder.**
  - One payment ticket says "Checkout or Payment Element" without choosing.
  - The same ticket says "unpaid accepted bookings follow a defined timeout", but the spec never defines it. The booking-request ticket does set "default 48h" for its own expiry, so the engine can do this. It just missed here.
  - The scaffold ticket says "deployable to a staging environment" without naming a host.
- **No trace from stories to tickets.** The spec numbers its user stories, but no ticket cites them, so coverage can't be checked in either direction.
- **Non-code blockers sit outside the waves.** The legal entity, payment platform account, identity-provider account, lawyer-reviewed terms and partner agreement appear only in the spec's notes. Tickets that need them to go live don't depend on them.
- **No sizing against capacity.** The plan has 23 tickets, 13 waves and a 13-ticket critical path. Only two waves allow real parallel work, and each ticket gets a second reviewer and up to two review rounds. The builder's weekly hours were never set, and the spec itself says to count back from the deadline. Nothing blocks on that count.

## Suggested readiness checks

The exporter could run these checks before any ticket is marked ready-for-agent. Each one is mechanical and would have caught a defect above.

- [ ] Every decision node is final, or links to what superseded it. No deferral text ("wait until…") is exported as a decision.
- [ ] Free-text answers are split into the decision and operator directives. Directives never reach agent-facing files.
- [ ] The readiness verdict in intent.md matches the ticket statuses, or the file is labelled as a pre-interview snapshot.
- [ ] The repo scan ran (scoutCommit and headCommit are set), or the bundle says "greenfield" and ticket 01 owns the verify command.
- [ ] The bundle path is not matched by .gitignore (git check-ignore returns nothing).
- [ ] No ticket contains an unresolved "X or Y", or a "defined"/"configurable" value without a default.
- [ ] Every user story maps to at least one ticket, and every ticket cites at least one story or spec rule.
- [ ] Each external prerequisite (accounts, legal entity, reviewed terms) is a ticket or a named gate that the tickets needing it depend on.
- [ ] Critical-path length and ticket count are checked against a stated hours-per-week budget and deadline. If either is unknown, the bundle status is blocked: capacity unknown, not ready-for-agent.
