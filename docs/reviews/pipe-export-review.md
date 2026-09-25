# External review: Grill Room export (Pipe)

Pipe reviewed one real bundle: a two-sided services marketplace, exported to a greenfield repository (23 tickets, 23 briefs, 13 waves). The verdict: keep the decision trail and the delegation briefs, fix the export first.

The review is tracked as epic `gr-ibp` (label `ext-review-pipe`). The close-out bead, which reports back to Pipe for validation, is blocked until every fix below lands.

## What to keep

These are guardrails for any rework:
- decision provenance and `Depends on:` lists;
- testable spec rules and the out-of-scope list;
- facts kept apart from risks;
- Build / Judged-by tickets with observable acceptance;
- self-contained, safe briefs;
- the fresh-context reviewer;
- build records.

## Items and where they are tracked

| Pipe's item | Bead | Owner decision |
|---|---|---|
| 1. Superseded decisions exported as live | gr-ibp.1 | |
| 2. Raw answers pass through unedited | gr-ibp.2 | |
| 3. Readiness verdict never re-run | gr-ibp.3 | |
| 4. Repo facts stated but never checked | gr-ibp.4, gr-0hy, gr-9vg | |
| 5. Verify command assumed | gr-ibp.4, gr-c0t.9 | |
| 6. Brief text duplicates ticket text | gr-ibp.6 | Keep the copy. Regenerate it whenever the ticket changes. |
| 7. Build-record commands repeated | gr-ibp.5 | |
| Empty boundaries and facts slots | gr-ibp.4, gr-c0t.9 | |
| Open choices passed to the builder | gr-1vd | |
| No trace from stories to tickets | gr-ibp.7 | |
| Non-code blockers outside the waves | gr-ibp.8 | |
| No sizing against capacity | gr-ibp.9 | Warn, do not block. |

## Validation

Validation happens when the close-out bead is ready:
- export a fresh greenfield bundle;
- send Pipe a response page that maps each item to its fix and to where it shows in the new bundle;
- record his verdict per item in this file.
