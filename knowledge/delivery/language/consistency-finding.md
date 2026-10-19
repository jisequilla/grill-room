---
type: Term
title: Consistency finding
description: A statement in the spec or tickets that leaves a builder to decide something the owner never decided.
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
  - reopen card
code:
  - grill-room/server/consistency.ts:1
  - grill-room/server/db/schema.ts:573
---

# Consistency finding

The owner asks it, which turns it into an Interview [decision](/interview/language/decision.md), or dismisses it. This is where Delivery feeds back into Interview.[^contexts]

[^contexts]: Placed in this context by the session that drew the bounded contexts, from the vocabulary inventory it records ([fragment](/_fragments/2026-10-19-session-contexts/fragment.md)).
