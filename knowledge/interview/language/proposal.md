---
type: Term
title: Proposal
description: A pending suggestion about a decision's own answer, answered-by, replacement, deferral or restatement, that the owner accepts or dismisses.
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
  - suggestion
code:
  - grill-room/server/proposal.ts:1
---

# Proposal

A decision holds at most one; a dismissed one is remembered until the answer changes. This context also uses "proposal" for the interviewer's output, the [round proposal](round-proposal.md), and whether one of them gets a new name is [open](/interview/questions/two-proposals-in-the-interview.md). The scout proposal and the delegation proposal belong to Project knowledge.[^contexts]

[^contexts]: Placed in this context by the session that drew the bounded contexts, from the vocabulary inventory it records ([fragment](/_fragments/2026-10-19-session-contexts/fragment.md)).
