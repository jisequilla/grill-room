# 08 Add the pre-flight step to HANDOFF in both recipes, with a project switch

Status: ready-for-agent
Blocked by: 02
Bead: `gr-c0t.31`

## What to build

- In `grill-room/server/handoff.ts`, render a pre-flight step in the before-launch part of the lifecycle, in both the pull-request and the local-merge recipe, when the project's pre-flight switch (ticket 2) is on.
- The step belongs to the orchestrating session, not the builder. It embeds the full read-only pre-flight prompt: check the ticket against the code at the current head for wrong premises, ambiguities, contradictions, boundary gaps and owner decisions, and end with a verdict of clear or needs changes. It says a ticket launches only on a clear verdict. Use `.claude/templates/delegation/preflight.md` as the reference for the wording.
- The step states the measured cost: roughly 210-230k tokens and 4-6 minutes per ticket. It names no model.
- When the switch is off, the step is absent from both recipes.
- Add the switch to `grill-room/app/components/projects/project-delivery-settings.tsx`, next to the review switch, with strings in `grill-room/app/i18n/`.
- Existing projects have the switch on after migration, so their next export gains the step without their stored handoffs going stale.

## How it will be judged

- `grill-room/server/handoff.test.ts`: the step appears in both recipes when on and in neither when off; it contains the five check kinds, the two verdicts, the launch-only-when-clear rule and the cost; it contains no model name.
- A test shows a migrated project renders the step and its stored handoff fingerprint is unchanged; switching pre-flight off changes the fingerprint.
- `grill-room/app/components/projects/project-delivery-settings.test.tsx` covers the new switch.
- The handoff snapshot is updated for the new step.
