---
type: Use case
title: Learn from build outcomes
description: The Idea owner sees, per ticket and across a session, which model built it, whether the first attempt passed, whether it escalated and what the prompt was missing.
tags: [use-case, build]
status: draft
generated:
  by: claude-code/claude-opus-5-5
  at: 2026-10-16T14:00:00+02:00
sources:
  - id: founding
    resource: /_fragments/2026-09-21-0639-founding-spec/fragment.md
    title: Founding spec of Grill Room
# ── product ───────────────────────────
role: /product/roles/idea-owner.md
stage: build
state: built
code:
  - grill-room/actions/set-build-record.ts:11
  - grill-room/actions/get-build-summary.ts:9
---

# Learn from build outcomes

Each ticket keeps a build record of how building it went, which the owner can correct, summarised across the session as first-attempt pass rate and escalations, so they learn where their specs fall short.[^founding]

[^founding]: Founding spec, stories 76-77, 79-80 ([fragment](/_fragments/2026-09-21-0639-founding-spec/fragment.md)).
