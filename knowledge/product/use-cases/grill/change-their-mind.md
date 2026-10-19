---
type: Use case
title: Change their mind
description: The Idea owner reopens a settled decision at any point, sees what it puts in doubt, and gets the tree consistent again without being re-asked what still holds.
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
  - grill-room/actions/reopen-decision.ts
  - grill-room/server/stale-review.ts:1
---

# Change their mind

Reopening a decision, even after the interviewer proposed being done, marks everything downstream stale. The interviewer reconfirms what the change leaves standing and re-asks the rest; earlier answers stay as history.[^founding]

[^founding]: Founding spec, stories 44-49 ([fragment](/_fragments/2026-09-21-0639-founding-spec/fragment.md)).
