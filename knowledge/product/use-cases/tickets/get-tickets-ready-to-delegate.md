---
type: Use case
title: Get tickets ready to delegate
description: The Idea owner gets the spec broken into tickets an agent can each complete, with what blocks them, regenerated when the spec changes.
tags: [use-case, tickets]
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
stage: tickets
state: built
code:
  - grill-room/actions/break-into-tickets.ts:49
  - grill-room/actions/list-tickets.ts
  - grill-room/actions/set-ticket-blocked-by.ts
---

# Get tickets ready to delegate

Each ticket is sized for one agent and says what blocks it, so the owner sees what can be built in parallel. Tickets are listed with their status and regenerated when the spec changes.[^founding]

[^founding]: Founding spec, stories 65-69 ([fragment](/_fragments/2026-09-21-0639-founding-spec/fragment.md)).
