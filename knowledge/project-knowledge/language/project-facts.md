---
type: Term
title: Project facts
description: "What the server itself knows about a repository without asking a model: its files, its tracked decisions.md files, its HEAD."
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
  - fact pack (outside the scout prompt)
code:
  - grill-room/server/project-facts.ts:1
---

# Project facts

A repository with no commits has no HEAD, and Delivery then describes it as greenfield instead of assuming facts about it.[^contexts]

[^contexts]: Placed in this context by the session that drew the bounded contexts, from the vocabulary inventory it records ([fragment](/_fragments/2026-10-19-session-contexts/fragment.md)).
