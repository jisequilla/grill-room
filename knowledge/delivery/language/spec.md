---
type: Term
title: Spec
description: The document synthesized from a confirmed session's settled decisions, in the to-spec template's sections.
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
  - PRD
  - requirements doc
code:
  - grill-room/actions/synthesize-spec.ts:25
  - grill-room/server/db/schema.ts:508
---

# Spec

One per session, regenerated when decisions change. The same word names the exported spec.md file and a spec published by /to-spec; in this language it is the synthesized document.[^contexts]

[^contexts]: Placed in this context by the session that drew the bounded contexts, from the vocabulary inventory it records ([fragment](/_fragments/2026-10-19-session-contexts/fragment.md)).
