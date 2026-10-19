---
type: Term
title: Repo rules
description: The repository's own instructions to agents (its root CLAUDE.md, AGENTS.md and the files in .claude/rules), read as rules a brief must respect.
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
  - rules (alone)
  - conventions
code:
  - grill-room/server/repo-rules.ts:1
---

# Repo rules

Not the tree rules that refuse a bad round in Interview. When a ticket cannot follow one inside its file boundaries, Delivery records a rule conflict the owner can waive.[^contexts]

[^contexts]: Placed in this context by the session that drew the bounded contexts, from the vocabulary inventory it records ([fragment](/_fragments/2026-10-19-session-contexts/fragment.md)).
