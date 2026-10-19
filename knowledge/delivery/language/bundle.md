---
type: Term
title: Bundle
description: "Everything an export writes into a project: spec, decisions.md, intent.md, tickets, HANDOFF.md and briefs."
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
  - package
  - handoff package
code:
  - grill-room/server/export-bundle.ts:1
---

# Bundle

Split by lifetime into a durable folder (spec, decisions, intent) and a working folder of build files that can be deleted. It states only what was checked and settled.[^contexts]

[^contexts]: Placed in this context by the session that drew the bounded contexts, from the vocabulary inventory it records ([fragment](/_fragments/2026-10-19-session-contexts/fragment.md)).
