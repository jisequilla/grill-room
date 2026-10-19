---
type: Term
title: Card
description: One question of a round as the Idea owner answers it, with the interviewer's recommended answer and any offered choices.
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
  - question card
  - reopen card
code:
  - grill-room/app/components/workspace/round-card.tsx:1
---

# Card

Each card asks one [decision](decision.md). A consistency finding raised in Delivery and asked of the owner becomes a decision first, and is then asked on a card like any other.[^contexts]

[^contexts]: Placed in this context by the session that drew the bounded contexts, from the vocabulary inventory it records ([fragment](/_fragments/2026-10-19-session-contexts/fragment.md)).
