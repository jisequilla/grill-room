# 07 Spec names the depth and the spec check scales its builder-alone bar

Status: ready-for-agent
Blocked by: 01
Implements: user stories 40-41, 43-44
Implements decisions: `depth-downstream`, `level-downstream`, `summary-in-plain-words-for-non-technical`

Pass depth into spec synthesis and the consistency check. In `grill-room/server/interviewer/prompt.ts` the spec prompt names the depth in Summary and Further Notes; the builder-alone check accepts builder-alone decisions at proof-of-concept, flags only user-facing ones at first working version, and keeps today's bar at full spec. `grill-room/actions/synthesize-spec.ts` and `grill-room/actions/check-consistency.ts` read the session's depth. Technical level is not passed downstream; the plain-words Summary rule stays fixed. Tickets and handoff unchanged.

Judged by: extend `grill-room/server/consistency.test.ts` so the same decision set yields a builder-alone finding at full spec and none at proof-of-concept; a spec test asserting the depth appears.