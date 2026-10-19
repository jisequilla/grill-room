---
type: Term
title: Readiness
description: "The interviewer's judgment, before the first round, of whether the idea holds enough to grill: ready or not ready, with what it found and what is missing."
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
  - preflight
  - pre-flight
code:
  - grill-room/server/readiness.ts:1
  - grill-room/server/db/schema.ts:213
---

# Readiness

The interview's opening move. It warns and never blocks. It is judged with the project's scout report when the session has a project, and goes stale when the idea changes. "Preflight" is a word to avoid for it: in [Delivery](/delivery/language/pre-flight.md) a pre-flight is the check before a ticket launches.[^contexts]

[^contexts]: Placed in this context by the session that drew the bounded contexts, from the vocabulary inventory it records ([fragment](/_fragments/2026-10-19-session-contexts/fragment.md)).
