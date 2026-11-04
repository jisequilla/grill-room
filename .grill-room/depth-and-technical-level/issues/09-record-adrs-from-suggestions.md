# 09 Record ADRs from suggestions

Status: ready-for-agent
Blocked by: 01, 02, 03, 04, 05, 06, 07, 08

Record the repo's ADRs from the suggestions Grill Room wrote for this build.

The suggestions are in `.grill-room/depth-and-technical-level/adr-suggestions/`, one per decision:
- `level-change-writes-back.md`: What a mid-session level change updates
- `level-storage.md`: Where the owner's technical level is stored
- `owner-identity.md`: How an owner is identified for the profile table
- `profile-table-shape.md`: Where the level sits relative to the Better Auth user

If that folder is not in your worktree, read it from the main checkout at the same path. Never write to it.

For each suggestion, write an ADR in the repo's own ADR folder, in its own convention and numbering, from the suggestion's sections. Where a suggestion has an Amends section, the new ADR amends that existing ADR: link them the way the repo does, and never delete or rewrite the old one. Set each ADR's status the way the repo marks an accepted decision once the tickets that build it have landed.

Detected convention, a hint to check against the folder: ADRs live in `docs/adr/`, named like `0002-mutation-run-as-a-workflow-step.md`; the next free number looks like `0003`. The newest ADR's sections are Context, Decision, Alternatives, Consequences, Tickets (from `docs/adr/0002-mutation-run-as-a-workflow-step.md`).

Done when every suggestion listed above has a committed ADR in the repo. Close this ticket before the working folder is deleted: the suggestions are deleted with it.