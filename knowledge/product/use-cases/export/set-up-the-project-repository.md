---
type: Use case
title: Set up the project repository
description: From inside the app, the Idea owner picks an existing repository or creates a new private one in one action, instead of preparing a Git repository by hand first.
tags: [use-case, export]
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
stage: export
state: wanted
code: []
---

# Set up the project repository

Export needs a Git repository that already exists, which is friction for Pipe. He wants choosing an existing repository, or creating a new private one, to be one action in the app.[^meeting]

**Technical level.** Preparing a Git repository by hand is the kind of step a non-technical owner cannot take alone.

**Missing.** Registering a project refuses any folder that is not already inside a Git repository (`grill-room/server/projects.ts:185`); nothing creates or clones one.

[^meeting]: Pipe in the meeting of 2026-09-29: "Repository setup" ([fragment](/_fragments/2026-09-29-2130-pipe-meeting/fragment.md)).
