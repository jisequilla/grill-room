---
type: Decision
title: Depth is chosen per session and asked with the level before readiness
description: Each session has a depth in three steps, asked with the owner's technical level in a setup step at session creation, changeable at any round, and read by readiness.
tags: [depth, technical-level, readiness, sharpening]
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

# Depth is chosen per session and asked with the level before readiness

[Depth](/interview/language/depth.md) belongs to the [session](/interview/language/session.md), in three steps: proof of concept, first working version, full spec. A setup step at session creation, before [readiness](/interview/language/readiness.md) runs, asks it and shows the owner's [technical level](/interview/language/technical-level.md) pre-filled and editable. The step can be skipped: the interviewer then assumes first working version and not technical, at runtime only. A profile with no level yet shows nothing selected and saves nothing until the owner picks one.[^depth]

Both values can change at any round and apply from the next one; cards already asked stay. A depth change:

- before round 1 re-judges readiness and clears any "Grill it as is" override; while a turn is working it is stored, the latest value wins, the control says it applies when the step finishes, and one re-judge runs when the turn ends;
- during [Sharpening](/interview/language/sharpening.md), when the re-judge finds the idea ready, lets the open round finish before Sharpening stops;
- after the interviewer proposed done but before a spec exists, withdraws the done proposal and reopens the frontier;
- after a spec exists, also marks the spec, its check and the tickets stale;
- after round 1 leaves the readiness judgment as it was, recording the depth it was made at. Judgments from before depth existed carry none, and the panel says so.

Readiness reads depth and scales what counts as ready, still warning and never blocking.[^depth]

Why: depth describes the idea, not the person, so the same owner can want a proof of concept for one idea and a full spec for another. Sharpening runs only for a not-ready idea and readiness has already judged by the time its panel shows, so only a step at creation reaches every owner before anything is judged. A proof-of-concept owner sent to Sharpening over a full-spec gap is the over-grilling this exists to stop.[^depth]

[^depth]: Session on depth and technical level before the grill, choices 1, 3, 5, 9, 10, 15, 19, 20, 24-28, 31, 33 and 34 ([fragment](/_fragments/2026-11-04-session-depth-and-level/fragment.md)).
