---
type: Term
title: Adversarial review
description: A second, fresh-context agent's attempt to break one ticket's change against the spec, without the builder's report.
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
  - review (alone)
  - code review
code:
  - grill-room/server/db/schema.ts:131
---

# Adversarial review

The Review agent does it. Not the [stale review](/interview/language/stale-review.md) of Interview.[^contexts]

[^contexts]: Placed in this context by the session that drew the bounded contexts, from the vocabulary inventory it records ([fragment](/_fragments/2026-10-19-session-contexts/fragment.md)).
