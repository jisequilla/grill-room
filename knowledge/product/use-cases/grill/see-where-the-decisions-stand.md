---
type: Use case
title: See where the decisions stand
description: The Idea owner sees every decision as a tree with its dependencies and a state the app computes, and is never asked something whose prerequisites are still open.
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
contexts: [interview]
state: built
code:
  - grill-room/server/tree.ts:114
  - grill-room/server/tree.ts:1036
  - grill-room/app/components/workspace/design-tree.tsx
---

# See where the decisions stand

Every decision appears in an indented tree with what it depends on and whether it is settled, on the frontier, blocked or stale; loose ends stand out. Selecting one shows its question, answer and history. The app computes the states, not the interviewer, and refuses a round that asks a question whose prerequisites are open.[^founding]

[^founding]: Founding spec, stories 35-43 ([fragment](/_fragments/2026-09-21-0639-founding-spec/fragment.md)).
