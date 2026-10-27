---
type: Term
title: Round proposal
description: "What an interviewer turn returns for a round: new decisions, responses to push backs, placements of added decisions, and whether the tree is done."
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
  - proposal (alone)
code:
  - grill-room/actions/request-next-round.ts:1
---

# Round proposal

A second meaning of "proposal" inside this context, beside the [Proposal](proposal.md) on a decision's answer. Whether it gets a word of its own is [open](/interview/questions/two-proposals-in-the-interview.md).[^contexts]

[^contexts]: Placed in this context by the session that drew the bounded contexts, from the vocabulary inventory it records ([fragment](/_fragments/2026-10-19-session-contexts/fragment.md)).
