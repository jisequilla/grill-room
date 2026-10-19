---
type: Term
title: Ticket
description: A unit of work broken out of the spec, sized for one agent, saying what blocks it, which stories it implements, and what it consumes and produces.
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
  - issue
  - task
code:
  - grill-room/server/db/schema.ts:632
  - grill-room/actions/break-into-tickets.ts:49
---

# Ticket

A build ticket is built by a Build agent; a gate ticket names a prerequisite outside the code. The exported file lives under issues/, and the project's tracker may hold it as a bead; in this language all three are the ticket.[^contexts]

[^contexts]: Placed in this context by the session that drew the bounded contexts, from the vocabulary inventory it records ([fragment](/_fragments/2026-10-19-session-contexts/fragment.md)).
