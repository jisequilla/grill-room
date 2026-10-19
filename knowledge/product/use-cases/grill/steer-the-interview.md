---
type: Use case
title: Steer the interview
description: "The Idea owner shapes the interview instead of only answering it: they can say they don't know, push back, defer, flag a question for a prototype, or add a decision of their own."
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
  - grill-room/actions/save-draft-answer.ts:10
  - grill-room/actions/add-decision.ts
  - grill-room/server/tree.ts:199
---

# Steer the interview

"I don't know" is a real answer the interviewer reacts to. A push back with a reason reshapes the tree rather than rephrasing the question. A deferred question keeps what depends on it blocked. A question that needs a prototype pauses until the owner answers it with what the prototype taught. A decision the interviewer never asked about can be added and gets placed in the tree.[^founding]

The prototype's lesson is given through the ordinary answer to its loose end; there is no form of its own for it.

[^founding]: Founding spec, stories 25-34 ([fragment](/_fragments/2026-09-21-0639-founding-spec/fragment.md)).
