---
type: Term
title: Scout report
description: "What the project scout found for an idea: what is built, partial or a gap, and the decisions the repository already holds."
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
  - scan
code:
  - grill-room/server/scout-report.ts:1
  - grill-room/server/db/schema.ts:862
---

# Scout report

It names the commit it read, and goes stale when the repository moves on. Its decisions arrive as [scout proposals](scout-proposal.md).[^contexts]

[^contexts]: Placed in this context by the session that drew the bounded contexts, from the vocabulary inventory it records ([fragment](/_fragments/2026-10-19-session-contexts/fragment.md)).
