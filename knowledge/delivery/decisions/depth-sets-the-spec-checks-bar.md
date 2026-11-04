---
type: Decision
title: Depth sets the spec check's bar; technical level changes nothing downstream
description: The spec names the session's depth and the spec check allows more to be left to the builder at lower depths; tickets follow the spec, and technical level changes no artifact.
tags: [depth, technical-level, spec, consistency-finding]
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

# Depth sets the spec check's bar; technical level changes nothing downstream

The [spec](/delivery/language/spec.md) names the session's [depth](/interview/language/depth.md), and the spec check reads it: at lower depths more may be left to the builder. [Tickets](/delivery/language/ticket.md) derive from the spec with no depth branch of their own. [Technical level](/interview/language/technical-level.md) changes nothing after the interview.[^depth]

Why: without depth the check would flag gaps a proof-of-concept owner chose to leave. The spec and tickets are read by the builder whatever the owner's level, and the plain-words Summary and the "Left to the builder" section already serve a non-technical owner.[^depth]

[^depth]: Session on depth and technical level before the grill, choices 7 and 13 ([fragment](/_fragments/2026-11-04-session-depth-and-level/fragment.md)).
