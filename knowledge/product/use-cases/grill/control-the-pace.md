---
type: Use case
title: Control the pace
description: The Idea owner chooses per session between answering a whole round at once and one question at a time, and can switch.
tags: [use-case, grill]
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
stage: grill
state: built
code:
  - grill-room/actions/set-session-answering-mode.ts
  - grill-room/actions/request-next-round.ts:143
---

# Control the pace

A delicate idea can be slowed down to one question at a time, and a session can switch back to whole rounds whenever the owner wants.[^founding]

[^founding]: Founding spec, stories 19-20 ([fragment](/_fragments/2026-09-21-0639-founding-spec/fragment.md)).
