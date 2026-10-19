---
type: Term
title: Claim
description: "Another decision's link to this decision's answer: a pending supersession by it, or a record of having been replaced by it."
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
  - reference
  - link
code:
  - grill-room/server/withdraw-claims.ts:1
---

# Claim

A claim rests on the answer as it stood, so it lapses when that answer changes. A reword lapses only the pending supersessions.[^contexts]

[^contexts]: Placed in this context by the session that drew the bounded contexts, from the vocabulary inventory it records ([fragment](/_fragments/2026-10-19-session-contexts/fragment.md)).
