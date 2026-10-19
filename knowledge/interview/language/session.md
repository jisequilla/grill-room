---
type: Term
title: Session
description: One grilling interview of one idea, from the idea to a confirmed shared understanding, with everything decided in it.
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
  - grill
  - conversation
code:
  - grill-room/server/db/schema.ts:154
---

# Session

Its state is interviewing, done-proposed or confirmed. A session may belong to a [project](/project-knowledge/language/project.md). The interviewer's resumable Claude conversation and a Claude CLI session id are not sessions in this language.[^contexts]

[^contexts]: Placed in this context by the session that drew the bounded contexts, from the vocabulary inventory it records ([fragment](/_fragments/2026-10-19-session-contexts/fragment.md)).
