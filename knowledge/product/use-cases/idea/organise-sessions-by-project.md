---
type: Use case
title: Organise sessions by project
description: "The Idea owner works project first: a project is the place their sessions live in, and starting a session from it carries the project along."
tags: [use-case, idea]
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
stage: idea
state: partial
code:
  - grill-room/app/routes/projects.$projectId.tsx:83
  - grill-room/server/db/schema.ts:170
  - grill-room/actions/set-session-project.ts
---

# Organise sessions by project

Pipe wants the project on top, with sessions inside it, so the project's context shapes each new grill; today he meets the project only at the end, when export asks for it.[^meeting] Projects are a top-level place with a Sessions tab, and a session belongs to one project.

**Missing.** A session cannot be started from its project's page: the New session dialog is global and the project is picked in a field (bead `gr-yys.14`). The project is still something a session is attached to, not where it begins.

[^meeting]: Pipe in the meeting of 2026-09-29: "Projects first" and "Choosing the project" ([fragment](/_fragments/2026-09-29-2130-pipe-meeting/fragment.md)).
