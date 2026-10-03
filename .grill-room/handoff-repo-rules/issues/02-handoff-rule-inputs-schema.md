# 02 Store the new handoff inputs and keep the fingerprint stable at defaults

Status: ready-for-agent
Blocked by: none
Bead: `gr-c0t.25`

## What to build

The storage and fingerprint groundwork that the later rendering tickets share, so they do not chain through the schema.

- In `grill-room/server/db/schema.ts` and `grill-room/server/db/migrations.ts`, add to the project:
  - a pre-flight switch, migration default on;
  - confirmed repository delegation values, each with its citation (file and line): prune command, review rule, pre-flight procedure pointer. The confirmed cap keeps using the existing `maxTicketsInFlight`, plus a stored citation for it;
  - pending delegation proposals (value plus citation per slot), stored as render inputs but not applied.
- Add storage for rule-conflict waivers, keyed on ticket, rule file and the set of missing files, with a reason.
- Add defaults and types in `grill-room/shared/session-constants.ts`, and read/write support in `grill-room/server/projects.ts` and `grill-room/actions/update-project.ts`.
- Extend the handoff fingerprint in `grill-room/server/handoff.ts`: each new input joins only when it differs from its migration default (pre-flight only when off; confirmed values, proposals and waivers only when present).

No rendering changes in this ticket: HANDOFF and briefs render exactly as before.

## How it will be judged

- `grill-room/server/db/migrations.test.ts` covers the new columns and table; an existing project migrates with pre-flight on and nothing else set.
- A fingerprint test shows a project with all new inputs at their defaults has the same fingerprint as before this change, and each new input changes the fingerprint only when non-default. Follow the existing tests for `deliveryRecipe`, `adversarialReview` and `maxTicketsInFlight`.
- The handoff snapshot in `grill-room/server/__snapshots__/handoff.test.ts.snap` is unchanged.
