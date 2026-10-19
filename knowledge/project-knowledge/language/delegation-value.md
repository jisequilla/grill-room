---
type: Term
title: Delegation value
description: How the repository itself says work is delegated (tickets in flight, review rule, pre-flight, prune command), with its citation; while unconfirmed, a delegation proposal.
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
  - delegation setting
code:
  - grill-room/server/delegation-values.ts:23
  - grill-room/server/db/schema.ts:140
---

# Delegation value

The handoff scout proposes it; the owner confirms or dismisses it. Confirmed, it overrides the project's default [delivery recipe](/delivery/language/delivery-recipe.md) settings in HANDOFF.md. Its vocabulary is split across this context, the project's row and the handoff.[^contexts]

[^contexts]: Placed in this context by the session that drew the bounded contexts, from the vocabulary inventory it records ([fragment](/_fragments/2026-10-19-session-contexts/fragment.md)).
