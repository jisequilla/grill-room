---
type: Use case
title: Find and resume a session
description: The Idea owner finds a session by title, state and last activity, and picks it up where they left it, half-answered round included.
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
  - grill-room/actions/list-sessions.ts:9
  - grill-room/actions/save-draft-answer.ts
  - grill-room/actions/delete-session.ts
---

# Find and resume a session

The Idea owner sees every session with its title, its state (interviewing, awaiting confirmation, confirmed) and when it last moved, so they know which needs them. Opening one lands them where they stopped, with draft answers kept across reloads; an abandoned one can be deleted.[^founding]

[^founding]: Founding spec, stories 7-11 ([fragment](/_fragments/2026-09-21-0639-founding-spec/fragment.md)).
