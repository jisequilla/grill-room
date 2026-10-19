---
type: Term
title: Scout
description: A read-only agent that reads a project's repository; the project scout reads it against an idea, the handoff scout against tickets.
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
  - explorer
code:
  - grill-room/actions/scout-project.ts:1
  - grill-room/server/brief-grounding.ts:1
---

# Scout

Both scouts belong here because both read the repository. The project scout serves Interview, through [readiness](/interview/language/readiness.md) and [scout proposals](scout-proposal.md). The handoff scout serves Delivery, by grounding [briefs](/delivery/language/brief.md) and proposing [delegation values](delegation-value.md).[^contexts]

[^contexts]: Placed in this context by the session that drew the bounded contexts, from the vocabulary inventory it records ([fragment](/_fragments/2026-10-19-session-contexts/fragment.md)).
