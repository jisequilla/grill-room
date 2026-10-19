# Session record: drawing the bounded contexts

Continuation of the Claude Code session that chose domain-driven design for the bundle's boundaries, closed on 2026-10-19. The owner (Jeremias De Isequilla) with Claude (claude-opus-5-5). Written by Claude at the time of capture. The owner's words are quoted literally; everything else is Claude's summary.

## The evidence

A research agent inventoried Grill Room's domain vocabulary across `GLOSSARY.md`, the database schema, the server modules, the actions, the UI strings and this bundle. It found:

- Nine clusters of tightly related terms: intake and readiness; interview and decision tree, with proposals and claims inside it; project grounding; project registry; spec and tickets; export bundle and handoff; build feedback; interviewer turn bookkeeping.
- Words that change meaning: "proposal" (an answer suggestion on a decision, the interviewer's round output, a delegation proposal, a scout proposal, and the done proposal), "decision" (a tree node, a repo decision, the exported decisions.md), "review" (stale review, adversarial review, the review digest), "brief" (the delegation brief, the brief strip in the interview's UI), "scout" (the project scout and the handoff scout), and "preflight". In the code "pre-flight" has one meaning, the check before a ticket launches; the check before the grill is called readiness, and "preflight" for it is meeting language.
- The strongest seams: the decision row carries the scout's provenance (`repoSource`, `repoCitation`, `scoutReportId`), so repo decisions share the interview's table; the scout reads exported decisions.md files back, so a past export feeds the next grill; export reads almost every other cluster; delegation vocabulary is split across the project registry, project grounding and the handoff; consistency findings and tickets point back into the decision tree. `server/tree.ts` imports nothing and is imported by almost everything.
- Tangles: `server/handoff.ts` mixes every delivery sub-vocabulary; the sessions row holds intake, interview, export and turn data together.

Claude checked two seams in the code: the repo columns on the decision row (`grill-room/server/db/schema.ts:393`) and the scout's import of the decisions-file parser (`grill-room/server/scout-report.ts:20`).

## The proposal

Claude proposed three contexts:

- **Interview**, the core: turning an idea into settled decisions, readiness included, since its job is the interview's opening move.
- **Project knowledge**, supporting: what the target repository already says (scouts, repo decisions, repo rules, delegation values, project facts).
- **Delivery**, supporting: turning settled decisions into work an agent can do (spec, tickets, bundle, handoff, briefs, pre-flight, build records), with the project registry's settings as part of its language.

Interviewer turn bookkeeping stays out of the bundle as a generic technical subdomain. The map: Interview is upstream of Delivery; a scout proposal becomes an Interview decision only when the owner keeps it; Delivery's exported decisions.md flows back through Project knowledge into the next interview, a loop only half built. The collisions sort by context, except that Interview keeps two meanings of "proposal".

## The owner's answers

On the three contexts, offered also a fourth Specification context or readiness placed elsewhere: "Yes, these three".

On the two meanings of "proposal" inside Interview: "Defer to the language step", recording both terms as they stand and an open question, because renaming a code-facing word is a code change to debate first.
