---
type: Term
title: Design tree
description: Every decision of a session with its dependencies, whose states the app works out so that nothing is asked before what it depends on is settled.
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
  - decision graph
  - tree view
code:
  - grill-room/server/tree.ts:1
---

# Design tree

The innermost model of Grill Room: its code imports nothing and nearly every other part reads it. Delivery conforms to it.[^contexts]

[^contexts]: Placed in this context by the session that drew the bounded contexts, from the vocabulary inventory it records ([fragment](/_fragments/2026-10-19-session-contexts/fragment.md)).
