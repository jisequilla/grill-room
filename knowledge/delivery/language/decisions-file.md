---
type: Term
title: decisions.md
description: The bundle's record of a session's settled decisions, with their provenance, dependencies and what they replaced.
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
  - decision log
code:
  - grill-room/server/export.ts:755
---

# decisions.md

Not a [decision](/interview/language/decision.md) itself: the export's account of Interview's decisions. A later scout reads it back as [repo decisions](/project-knowledge/language/repo-decision.md).[^contexts]

[^contexts]: Placed in this context by the session that drew the bounded contexts, from the vocabulary inventory it records ([fragment](/_fragments/2026-10-19-session-contexts/fragment.md)).
