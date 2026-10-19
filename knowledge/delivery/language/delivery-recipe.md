---
type: Term
title: Delivery recipe
description: How a ticket's work reaches the project's main branch, pull request or local merge, with the project's delivery settings that shape HANDOFF.md.
tags: [term, delivery]
status: draft
generated:
  by: claude-code/claude-opus-5-5
  at: 2026-10-19T12:00:00+02:00
sources:
  - id: contexts
    resource: /_fragments/2026-10-19-session-contexts/fragment.md
    title: Session that drew the bounded contexts
# ── delivery ───────────────────────────
avoid:
  - workflow
code:
  - grill-room/server/db/schema.ts:128
---

# Delivery recipe

The settings stored on the [project](/project-knowledge/language/project.md) (tracker, adversarial review, pre-flight, tickets in flight, verify command) are this context's language. A confirmed [delegation value](/project-knowledge/language/delegation-value.md) from the repository overrides them.[^contexts]

[^contexts]: Placed in this context by the session that drew the bounded contexts, from the vocabulary inventory it records ([fragment](/_fragments/2026-10-19-session-contexts/fragment.md)).
