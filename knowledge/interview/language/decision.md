---
type: Term
title: Decision
description: "A node of the design tree: one thing to settle, with what it depends on and, once answered, its answer and history."
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
  - question
  - node
code:
  - grill-room/server/db/schema.ts:248
---

# Decision

Its state (settled, frontier, blocked, stale) is computed, never stored. A [repo decision](/project-knowledge/language/repo-decision.md) from Project knowledge becomes a decision here when the owner keeps it; the decision row then carries the scout's provenance, which makes it the kernel the two contexts share. decisions.md is a different thing: [the export's record](/delivery/language/decisions-file.md) in Delivery.[^contexts]

[^contexts]: Placed in this context by the session that drew the bounded contexts, from the vocabulary inventory it records ([fragment](/_fragments/2026-10-19-session-contexts/fragment.md)).
