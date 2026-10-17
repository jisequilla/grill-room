---
type: Use case
title: Export into the project
description: The Idea owner exports the spec and tickets into their project in the layout their tools read, sees what was written, and never loses an edit made outside the app.
tags: [use-case, export]
status: draft
generated:
  by: claude-code/claude-opus-5-5
  at: 2026-10-16T14:00:00+02:00
sources:
  - id: founding
    resource: /_fragments/2026-09-21-0639-founding-spec/fragment.md
    title: Founding spec of Grill Room
  - id: meeting
    resource: /_fragments/2026-09-29-2130-pipe-meeting/fragment.md
    title: Meeting with Pipe on Grill Room's user experience
# ── product ───────────────────────────
role: /product/roles/idea-owner.md
stage: export
state: built
code:
  - grill-room/actions/preview-export.ts
  - grill-room/app/components/output/export-file-list.tsx:26
  - grill-room/server/export-bundle.ts:867
---

# Export into the project

Export writes the spec and numbered tickets in the local-markdown layout, lists the files it wrote, warns before overwriting a file edited outside the app, and fails loudly when the target is missing.[^founding] It is blocked until a project is chosen, which Pipe found buried at the bottom of the page.[^meeting]

Whether the project choice is now easy to find was not checked in the running app.

[^founding]: Founding spec, stories 70-75 ([fragment](/_fragments/2026-09-21-0639-founding-spec/fragment.md)).
[^meeting]: Pipe in the meeting of 2026-09-29: "Choosing the project" ([fragment](/_fragments/2026-09-29-2130-pipe-meeting/fragment.md)).
