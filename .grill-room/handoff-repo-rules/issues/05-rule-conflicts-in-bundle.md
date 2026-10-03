# 05 Compute rule conflicts and render rules and conflicts in briefs and HANDOFF

Status: ready-for-agent
Blocked by: 04, 11
Bead: `gr-c0t.28`

## What to build

- Compute a conflict per accepted rule claim as the required files that are not in the ticket's file boundaries. The server computes it; the scout never declares it. Expose the conflicts (ticket, rule citation, missing files) from a server function that rendering and the preview can both call.
- In `grill-room/server/handoff.ts`:
  - render every applicable rule claim in the ticket's brief as a cited fact in the existing codebase-facts section, including claims with no conflict;
  - render each conflict as an open question in the brief's existing open-questions section, with the stop-and-report instruction;
  - render each conflict in HANDOFF's existing section for questions left open, naming the ticket, the rule citation and the missing files.
- A hand-edited brief is kept unchanged: no rule facts and no conflict questions are added to it. Its conflict still renders in HANDOFF.
- Export is never blocked by a conflict. Rendering stays deterministic from stored inputs.

## How it will be judged

In `grill-room/server/handoff.test.ts` (and the snapshot):

- required files inside the boundaries produce no conflict and a cited fact in the brief;
- required files outside produce a conflict listing exactly the missing files; the ngine-monitor case (four required `package.json` files, `consumers/db-writer/package.json` outside the boundaries) is a named test;
- the conflict appears in HANDOFF's open questions and in the brief's open questions with stop-and-report;
- a hand-edited brief is byte-identical before and after rule-derived inputs are added, and its conflict still appears in HANDOFF;
- with no rule claims, HANDOFF and briefs render as before;
- `grill-room/actions/export-session.test.ts` shows export succeeds with conflicts present.
