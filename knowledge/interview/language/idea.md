---
type: Term
title: Idea
description: The loose text the Idea owner starts a session with, before anything is decided.
tags: [term, interview]
status: draft
generated:
  by: claude-code/claude-opus-5-5
  at: 2026-10-19T12:00:00+02:00
sources:
  - id: contexts
    resource: /_fragments/2026-10-19-session-contexts/fragment.md
    title: Session that drew the bounded contexts
# ── interview ───────────────────────────
avoid:
  - brief
  - prompt
code:
  - grill-room/server/db/schema.ts:157
---

# Idea

What the Idea owner types to start a session. It can be edited before the first round, and readiness is judged against the exact text it holds.[^contexts]

[^contexts]: Placed in this context by the session that drew the bounded contexts, from the vocabulary inventory it records ([fragment](/_fragments/2026-10-19-session-contexts/fragment.md)).
