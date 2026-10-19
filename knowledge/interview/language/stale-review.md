---
type: Term
title: Stale review
description: The interviewer's pass over the decisions downstream of a reopened one, reconfirming what still holds and re-asking the rest.
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
  - review (alone)
code:
  - grill-room/server/stale-review.ts:1
---

# Stale review

Not the [adversarial review](/delivery/language/adversarial-review.md) of Delivery, which checks a built ticket.[^contexts]

[^contexts]: Placed in this context by the session that drew the bounded contexts, from the vocabulary inventory it records ([fragment](/_fragments/2026-10-19-session-contexts/fragment.md)).
