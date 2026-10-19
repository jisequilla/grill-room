---
type: Term
title: Round
description: The set of questions the interviewer asks together, each on its own card, answered and submitted as a whole or one at a time.
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
  - turn
  - batch
code:
  - grill-room/server/db/schema.ts:451
---

# Round

What the interviewer produces for a round is a [round proposal](round-proposal.md). A turn is the technical call that produces it, outside this language.[^contexts]

[^contexts]: Placed in this context by the session that drew the bounded contexts, from the vocabulary inventory it records ([fragment](/_fragments/2026-10-19-session-contexts/fragment.md)).
