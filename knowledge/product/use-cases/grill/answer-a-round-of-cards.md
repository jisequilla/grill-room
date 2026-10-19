---
type: Use case
title: Answer a round of cards
description: The Idea owner answers each question on its own card, accepting the recommendation in one action when it fits, and submits the round when every card is answered.
tags: [use-case, grill]
status: draft
generated:
  by: claude-code/claude-opus-5-5
  at: 2026-10-16T14:00:00+02:00
sources:
  - id: founding
    resource: /_fragments/2026-09-21-0639-founding-spec/fragment.md
    title: Founding spec of Grill Room
# ── product ───────────────────────────
role: /product/roles/idea-owner.md
stage: grill
contexts: [interview]
state: built
code:
  - grill-room/app/components/workspace/round-card.tsx:135
  - grill-room/actions/submit-round.ts
  - grill-room/app/components/workspace/turn-panels.tsx:136
---

# Answer a round of cards

Each round is one card per question, with the interviewer's recommended answer. The Idea owner accepts it in one action, picks another offered choice, or writes their own; they see which cards are answered and submit the round as a whole. While the interviewer works they see that it is working, a failed turn shows a clear error with a retry, and earlier rounds stay readable.[^founding]

**Technical level.** Questions and recommendations are pitched the same way for every owner today; nothing adapts them to the owner's level.

[^founding]: Founding spec, stories 12-18, 21-24 ([fragment](/_fragments/2026-09-21-0639-founding-spec/fragment.md)).
