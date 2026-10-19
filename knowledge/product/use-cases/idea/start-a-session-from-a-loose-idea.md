---
type: Use case
title: Start a session from a loose idea
description: The Idea owner types a loose idea, names it and picks the interviewer model, and can start grilling without preparing anything.
tags: [use-case, idea]
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
stage: idea
contexts: [interview]
state: built
code:
  - grill-room/actions/create-session.ts:21
  - grill-room/app/components/sessions/create-session-dialog.tsx:65
  - grill-room/actions/set-default-model.ts
---

# Start a session from a loose idea

The Idea owner starts with nothing prepared: a loose idea typed in, a short title to tell it apart, and the interviewer model, defaulting to a global choice they can change. The session records which model interviewed them, so interview quality can be compared across models later.[^founding]

[^founding]: Founding spec, stories 1-6 ([fragment](/_fragments/2026-09-21-0639-founding-spec/fragment.md)).
