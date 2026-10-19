---
type: Term
title: Pre-flight
description: A read-only check of a ticket against the current code, just before it launches, for wrong premises, ambiguities and decisions only the owner can make.
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
  - readiness
code:
  - grill-room/server/handoff.ts:749
  - grill-room/server/db/schema.ts:139
---

# Pre-flight

Only this meaning in this context. The check before a grill is [readiness](/interview/language/readiness.md), which some owners call preflight.[^contexts]

[^contexts]: Placed in this context by the session that drew the bounded contexts, from the vocabulary inventory it records ([fragment](/_fragments/2026-10-19-session-contexts/fragment.md)).
