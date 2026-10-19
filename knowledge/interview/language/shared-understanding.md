---
type: Term
title: Shared understanding
description: "What the Idea owner confirms to end a session: the interviewer proposed being done, every loose end is resolved, and the owner agrees."
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
  - done
  - finished
code:
  - grill-room/actions/confirm-session.ts:53
---

# Shared understanding

Confirming it moves the session from done-proposed to confirmed. Only then does Delivery begin.[^contexts]

[^contexts]: Placed in this context by the session that drew the bounded contexts, from the vocabulary inventory it records ([fragment](/_fragments/2026-10-19-session-contexts/fragment.md)).
