---
type: Term
title: Build record
description: "The outcome of building one ticket: the model, whether the first attempt passed, whether it escalated, and what the prompt was missing."
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
  - build log
  - close comment
code:
  - grill-room/server/db/schema.ts:684
  - grill-room/actions/set-build-record.ts:11
---

# Build record

The Orchestrating agent writes it from the command line or over HTTP, without the browser. Nothing yet turns a build record into the next session; that would close the loop back through Project knowledge into Interview.[^contexts]

[^contexts]: Placed in this context by the session that drew the bounded contexts, from the vocabulary inventory it records ([fragment](/_fragments/2026-10-19-session-contexts/fragment.md)).
