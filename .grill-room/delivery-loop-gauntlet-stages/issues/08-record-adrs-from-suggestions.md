# 08 Record ADRs from suggestions

Status: ready-for-agent
Blocked by: 01, 02, 03, 04, 05, 06, 07

Record the repo's ADRs from the suggestions Grill Room wrote for this build.

The suggestions are in `.grill-room/delivery-loop-gauntlet-stages/adr-suggestions/`, one per decision:
- `mutation-role.md`: Mutation result: gate, report, or gate only on acceptance-covered lines
- `mutation-runner.md`: Who runs Stryker: the tests lens, a separate mutation critic, or a deterministic workflow step

If that folder is not in your worktree, read it from the main checkout at the same path. Never write to it.

For each suggestion, write an ADR in the repo's own ADR folder, in its own convention and numbering, from the suggestion's sections. Where a suggestion has an Amends section, the new ADR amends that existing ADR: link them the way the repo does, and never delete or rewrite the old one. Set each ADR's status the way the repo marks an accepted decision once the tickets that build it have landed.

No ADR convention was detected in this repository. Ask the owner where ADRs go, and how they are numbered, before writing them.

Done when every suggestion listed above has a committed ADR in the repo. Close this ticket before the working folder is deleted: the suggestions are deleted with it.