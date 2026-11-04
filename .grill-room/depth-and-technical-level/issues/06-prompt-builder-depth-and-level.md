# 06 Interviewer prompt pitched to depth and technical level

Status: ready-for-agent
Blocked by: 01
Implements: user stories 18-21, 23-27, 42
Implements decisions: `depth-shapes-interview`, `level-shapes-cards`, `technical-questions-for-non-technical-owner`, `builders-call-is-owner-set-aside`, `at-first-working-version-are-the-scale-a-2780456e`, `at-first-working-version-what-must-be-se-79b98f09`

Add `depth` and `technicalLevel` inputs to `buildPrompt` in `grill-room/server/interviewer/prompt.ts` and `grill-room/server/interviewer/types.ts`; `grill-room/server/turn.ts` reads depth from the session and level live via `getTechnicalLevel`, falling back to `DEFAULT_TECHNICAL_LEVEL` when null. Export the level prompt fragment so Sharpening (ticket 3) reuses it.

Depth section: proof of concept skips scale, edge-case and operations branches and proposes done once the core thing to try is settled; first working version opens edge-case branches, skips scale and operations, and proposes done when every user-facing flow and its data are settled with technology and operations allowed as builder's calls; full spec opens everything and holds done until nothing is left to the builder's guesswork.

Level section: builder keeps today's wording; technical-not-building keeps technical wording but phrases recommendations as consequences and recommends 'Leave it to the builder' for pure technology choices with no owner-visible consequence; not-technical uses plain wording (no paths or product names in card bodies) with the same recommendation shape. Technology cards are never suppressed; the interviewer never records its own recommendation as settled. Extend `grill-room/server/interviewer/fake.ts` to honour both inputs.

Judged by: prompt tests asserting each depth and level section per value (not exact wording); a fake scenario where a not-technical owner's technology card recommends builder's call while a builder's does not.