---
type: Use case
title: Grill the next thing from what was built
description: From what was built, the Idea owner starts the next grill with the evidence already in it, and the app knows what the project has already decided and built.
tags: [use-case, follow-up]
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
stage: follow-up
contexts: [interview, project-knowledge, delivery]
state: partial
code:
  - grill-room/actions/scout-project.ts:272
  - grill-room/server/project-facts.ts:55
---

# Grill the next thing from what was built

Pipe wants the project's context to shape the next grill: read the decisions it already holds so they are not asked again, suggest what to grill next from the tickets' status, and warn when a new feature depends on foundations not built yet. The building agent reports finished tickets back.[^meeting] Today a scout reads a registered project and proposes the decisions it already holds, for the owner to keep or drop.

**Missing.** No session starts from a build record or ticket with its evidence prefilled (epic `gr-0yo`), nothing suggests what to grill next, and nothing warns about missing foundations.

[^meeting]: Pipe in the meeting of 2026-09-29: "Projects first" and "The hand-off to building" ([fragment](/_fragments/2026-09-29-2130-pipe-meeting/fragment.md)).
