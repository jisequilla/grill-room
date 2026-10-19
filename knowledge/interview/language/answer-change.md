---
type: Term
title: Answer change
description: "Any write that gives a decision a new answer state: settling, deferring, rewording, unsettling or withdrawing it."
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
  - answer update
  - decision transition
code:
  - grill-room/server/answer-change.ts:1
---

# Answer change

The prior answer goes to the decision's history, and the decision's [proposal](proposal.md) and the [claims](claim.md) naming it lapse. A reword is the answer change that keeps meaning and kind and changes only the wording.[^contexts]

[^contexts]: Placed in this context by the session that drew the bounded contexts, from the vocabulary inventory it records ([fragment](/_fragments/2026-10-19-session-contexts/fragment.md)).
