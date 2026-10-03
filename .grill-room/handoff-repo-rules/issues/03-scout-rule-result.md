# 03 Hand rule sources to the handoff scout and extend its result with rule claims

Status: ready-for-agent
Blocked by: 01
Bead: `gr-c0t.26`

## What to build

The scout reads the collected rule sources as rules and reports on them, inside its existing single read-only turn.

- In `grill-room/server/handoff-fact-pack.ts`, hand the scout the collected rule sources from ticket 1, named as the repository's rules, each with its `paths:` globs where present.
- In `grill-room/server/interviewer/prompt.ts`, tell the handoff scout to read them as rules, to read frontmatter-less sources for every ticket, and to answer every rule file whose globs match a ticket's files.
- Extend the scout result in `grill-room/server/interviewer/schemas.ts` and `grill-room/server/interviewer/types.ts`:
  - per ticket, a list of rule claims: citation (rule source file and line), a statement of the rule, and the files the rule requires touching, or an explicit "requires no files";
  - per ticket, a flag that the ticket qualifies for two review lenses, with the repository's review rule cited;
  - for the report as a whole, proposed delegation values, each with a citation: in-flight cap, prune command, review rule, pre-flight procedure.
- All new fields are optional so a report without them is still valid in shape. Store accepted values with the grounding in `grill-room/server/brief-grounding.ts` and return them from `grill-room/actions/get-brief-grounding.ts`.
- Update `grill-room/server/interviewer/fake.ts` and `grill-room/server/interviewer/test-fixtures.ts` so the fake scout can return the new fields.

This ticket adds no new refusal conditions and no rendering.

## How it will be judged

- `grill-room/server/interviewer/schemas.test.ts` accepts a report with rule claims, a two-lens flag and proposals, and still accepts a report without them.
- `grill-room/server/handoff-fact-pack.test.ts` shows the rule sources and their globs in the fact pack, and nothing extra for a repository with none.
- `grill-room/actions/ground-briefs.test.ts` shows an accepted report's rule claims, flags and proposals are stored and returned by the grounding read.
- The scout still runs as one read-only turn on the same model.
