---
type: Term
title: Handoff
description: "HANDOFF.md: the Orchestrating agent's instructions for building the bundle, rendered from the session, spec, tickets and project."
tags: [term, delivery]
status: draft
generated:
  by: claude-code/claude-opus-5-5
  at: 2026-10-19T12:00:00+02:00
sources:
  - id: contexts
    resource: /_fragments/2026-10-19-session-contexts/fragment.md
    title: Session that drew the bounded contexts
# ── delivery ───────────────────────────
avoid:
  - handover
code:
  - grill-room/server/handoff.ts:1
---

# Handoff

It can be edited by hand, and export refuses a handoff gone stale. Its code is the largest module in the app and mixes most of this context's sub-languages.[^contexts]

[^contexts]: Placed in this context by the session that drew the bounded contexts, from the vocabulary inventory it records ([fragment](/_fragments/2026-10-19-session-contexts/fragment.md)).
