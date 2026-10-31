---
type: Term
title: Loose end
description: "A decision that blocks confirming the session: unknown, deferred, waiting for a prototype, or otherwise not settled."
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
  - open decision
  - gap
code:
  - grill-room/actions/list-loose-ends.ts:1
---

# Loose end

The owner resolves each one by answering it or setting it aside, as out of scope, as a named open question the owner still owes an answer to, or as a [builder's call](builders-call.md) left to whoever builds it. What the spec calls open questions start here.[^contexts]

[^contexts]: Placed in this context by the session that drew the bounded contexts, from the vocabulary inventory it records ([fragment](/_fragments/2026-10-19-session-contexts/fragment.md)).
