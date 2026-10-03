# 06 Show rule conflicts as advisory lines in the export preview

Status: ready-for-agent
Blocked by: 05
Bead: `gr-c0t.29`

## What to build

- Return the computed rule conflicts from `grill-room/actions/preview-export.ts`, each with the ticket, the rule citation and the missing files.
- In `grill-room/app/components/output/export-section.tsx`, show one advisory line per conflict next to the grounding state. The line names the ticket, the rule and the missing files.
- A conflict on a ticket whose brief is hand-edited is listed like any other.
- The export action stays available in every state. Add the new strings to the locale files under `grill-room/app/i18n/`.

## How it will be judged

- `grill-room/actions/preview-export.test.ts` shows conflicts in the preview payload, including one for a ticket with a hand-edited brief, and none when there are no conflicts.
- A component test (see `grill-room/app/components/output/export-section.test.ts`) shows the advisory line with ticket, rule and missing files, and that export is not disabled.
- Existing preview and export tests still pass.
