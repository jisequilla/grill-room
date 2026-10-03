# 09 Store scout delegation proposals and let the owner confirm them in the preview

Status: ready-for-agent
Blocked by: 02, 03, 04
Bead: `gr-c0t.32`

## What to build

- When a scout report is accepted, store its proposed delegation values (in-flight cap, prune command, review rule, pre-flight procedure), each with its citation, as pending proposals on the project (storage from ticket 2). Check each proposal's citation against the collected rule sources like any other rule citation.
- A proposal is never applied as a value until the owner confirms it.
- A new action, for example `grill-room/actions/confirm-delegation-value.ts`, confirms one proposal into project settings and clears it from pending. A confirmed cap is written to the existing `maxTicketsInFlight`, with its citation stored. A proposal can also be dismissed.
- Return pending proposals from `grill-room/actions/preview-export.ts` and show them in `grill-room/app/components/output/export-section.tsx`, next to the grounding state, each with its value, its citation and confirm and dismiss controls. Export stays available with proposals pending.
- A proposal equal to the already confirmed value is not shown again.

This ticket does not change HANDOFF rendering.

## How it will be judged

- Tests show an accepted report's proposals are stored as pending and leave the project's effective settings unchanged.
- Tests show confirming the cap updates `maxTicketsInFlight`; confirming the prune command, review rule and pre-flight pointer stores each with its citation; dismissing removes the proposal without changing settings.
- `grill-room/actions/preview-export.test.ts` lists pending proposals; a component test shows them with citation and controls, and export not disabled.
- A proposal with a citation outside the collected rule sources is refused with the report.
