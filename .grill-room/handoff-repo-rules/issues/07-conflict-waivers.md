# 07 Let the owner accept a rule conflict as is, with a reason

Status: ready-for-agent
Blocked by: 02, 05, 06
Bead: `gr-c0t.30`

## What to build

- A new action, for example `grill-room/actions/waive-rule-conflict.ts`, that stores a waiver with a reason, using the waiver storage from ticket 2. A second action or flag removes a waiver.
- A waiver is keyed on the ticket, the rule file and the set of missing files. It applies to a conflict only when all three match. It survives a re-grounding that finds the same conflict. It lapses (stops applying) when the ticket, the rule file or the missing-file set changes.
- A waived conflict no longer shows as a warning in the preview and no longer renders as an open question. In `grill-room/server/handoff.ts`, its reason renders in HANDOFF always, and in the ticket's brief unless the brief is hand-edited.
- In the export preview (`grill-room/app/components/output/export-section.tsx`), add an "accepted as is" control with a reason field on each conflict line, and show waived conflicts with their reason.
- Closing a conflict by editing the ticket or brief and re-grounding needs no new code: confirm with a test that the conflict disappears once the file is inside the boundaries.
- Waivers join the fingerprint only when present (ticket 2 built this; cover it here end to end).

## How it will be judged

- Action tests: a waiver survives re-grounding with the same ticket, rule file and missing files; it lapses when the missing-file set changes, when the rule file differs, and when the ticket changes.
- Rendering tests in `grill-room/server/handoff.test.ts`: a waived conflict produces no warning or open question; its reason renders in HANDOFF, in an unedited brief, and not in a hand-edited brief.
- Preview test: a waived conflict is not listed as a warning.
- A test shows re-grounding after widening the ticket's boundaries removes the conflict with no waiver.
- A project with no waivers has an unchanged fingerprint; adding one changes it.
