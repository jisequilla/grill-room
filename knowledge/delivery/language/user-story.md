---
type: Term
title: User story
description: A numbered statement in the spec of what a role wants and why, which tickets say they implement.
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
  - requirement
  - use case
code:
  - grill-room/server/db/schema.ts:657
---

# User story

Not a use case: a use case in this bundle is a role's goal across Grill Room, checked against the code; a user story is a line of one feature's spec.[^contexts]

[^contexts]: Placed in this context by the session that drew the bounded contexts, from the vocabulary inventory it records ([fragment](/_fragments/2026-10-19-session-contexts/fragment.md)).
