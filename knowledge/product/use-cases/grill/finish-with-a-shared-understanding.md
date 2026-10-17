---
type: Use case
title: Finish with a shared understanding
description: The Idea owner ends a grill only by confirming a shared understanding, after every loose end is answered or deliberately set aside.
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
  - grill-room/actions/confirm-session.ts:53
  - grill-room/actions/list-loose-ends.ts
  - grill-room/actions/disposition-decision.ts
---

# Finish with a shared understanding

When nothing is left to ask, the interviewer proposes being done and shows every settled decision. The owner sees the loose ends that block confirming and resolves each one: answer it, move it out of scope, or keep it as a named open question. Nothing is acted on until they confirm.[^founding]

[^founding]: Founding spec, stories 50-55 ([fragment](/_fragments/2026-09-21-0639-founding-spec/fragment.md)).
