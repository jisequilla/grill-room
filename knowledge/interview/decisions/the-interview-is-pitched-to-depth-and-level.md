---
type: Decision
title: The interview is pitched to depth and technical level
description: Depth decides which branches open and when done is proposed; technical level decides how cards are worded and recommended, and technology questions reach a non-technical owner in outcome terms.
tags: [depth, technical-level, builders-call, sharpening]
status: draft
generated:
  by: claude-code/claude-opus-5-5
  at: 2026-11-04T18:00:00+01:00
sources:
  - id: depth
    resource: /_fragments/2026-11-04-session-depth-and-level/fragment.md
    title: Session on depth and technical level before the grill
# ── decision ─────────────────────────
date: 2026-11-04
decided_by: [Jeremias De Isequilla]
state: in force
---

# The interview is pitched to depth and technical level

The interviewer reads both values every turn, and [Sharpening](/interview/language/sharpening.md) follows the same rules.[^depth]

| [Depth](/interview/language/depth.md) | Branches | Done is proposed when |
|---|---|---|
| Proof of concept | skips scale, edge-case and operations branches | the core thing to try is settled |
| First working version | opens edge cases, skips scale and operations | every user-facing flow and its data are settled; technology and operations may be [builder's calls](/interview/language/builders-call.md) |
| Full spec | opens every branch | nothing is left to the builder's guesswork |

[Technical level](/interview/language/technical-level.md) sets card wording, phrases recommendations as consequences (cost, speed, lock-in) rather than technologies for the two non-builder levels, and makes "Leave it to the builder" the recommended answer for a pure technology choice with no consequence the owner would see. Technology cards are never hidden, a builder's call stays the owner's action, and the interviewer never records its own recommendation as settled.[^depth]

Why: depth is felt most in which questions never get asked, so a done threshold alone would still spend a proof-of-concept owner's early rounds on branches they did not want. A non-technical owner can judge consequences even when they cannot judge technologies, and hiding technology cards would also hide choices with a cost or hosting consequence. Sharpening is the first thing a new non-technical owner meets.[^depth]

[^depth]: Session on depth and technical level before the grill, choices 6, 11, 12, 22, 23 and 32 ([fragment](/_fragments/2026-11-04-session-depth-and-level/fragment.md)).
