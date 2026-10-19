---
type: Term
title: Project
description: A registered Git repository that sessions belong to and export into.
tags: [term, project-knowledge]
status: draft
generated:
  by: claude-code/claude-opus-5-5
  at: 2026-10-19T12:00:00+02:00
sources:
  - id: contexts
    resource: /_fragments/2026-10-19-session-contexts/fragment.md
    title: Session that drew the bounded contexts
# ── project-knowledge ───────────────────────────
avoid:
  - repo (for the registration)
  - workspace
code:
  - grill-room/server/db/schema.ts:83
  - grill-room/server/projects.ts:1
---

# Project

Registering one needs a folder already inside a Git repository. Its delivery settings (recipe, tracker, review, tickets in flight, verify command) are [Delivery's](/delivery/language/delivery-recipe.md) language, stored on the project's row.[^contexts]

[^contexts]: Placed in this context by the session that drew the bounded contexts, from the vocabulary inventory it records ([fragment](/_fragments/2026-10-19-session-contexts/fragment.md)).
