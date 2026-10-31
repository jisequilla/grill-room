---
type: Use case
title: Know which choices are left to the builder
description: The Idea owner can tell the questions they still owe an answer from the choices deliberately left to whoever builds it.
tags: [use-case, spec]
status: draft
generated:
  by: claude-code/claude-opus-5-5
  at: 2026-10-16T14:00:00+02:00
sources:
  - id: meeting
    resource: /_fragments/2026-09-29-2130-pipe-meeting/fragment.md
    title: Meeting with Pipe on Grill Room's user experience
# ── product ───────────────────────────
role: /product/roles/idea-owner.md
stage: spec
contexts: [delivery, interview]
state: partial
code:
  - grill-room/server/handoff.ts:1510
  - grill-room/server/handoff.ts:1602
---

# Know which choices are left to the builder

Pipe reads "Open questions" as questions for him to answer, when many are decisions left to the builder.[^meeting]

Setting a loose end aside offers two kinds, an open question the owner owes and a [builder's call](/interview/language/builders-call.md) ([decision](/interview/decisions/setting-aside-offers-two-kinds.md)). The builder's calls get their own spec section and reach the tickets they concern, and the handoff asks only for the owner-owed ones ([decision](/delivery/decisions/builders-calls-have-their-own-spec-section.md)).

**Missing.** The spec puts every kept open question under further notes, and the handoff titles them "Questions the spec and tickets leave open" and asks for the owner's answer before delegating. There is no builder's call kind, no `## Left to the builder` section, no "Your call" in the briefs, and no way to switch an item between the two kinds after finishing.

[^meeting]: Pipe in the meeting of 2026-09-29: "'Open questions' misleads" ([fragment](/_fragments/2026-09-29-2130-pipe-meeting/fragment.md)).
