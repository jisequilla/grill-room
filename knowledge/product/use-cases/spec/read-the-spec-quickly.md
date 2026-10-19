---
type: Use case
title: Read the spec quickly
description: The Idea owner reads the spec in the app and gets its highlights first, in a handful of bullets, before the full text.
tags: [use-case, spec]
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
stage: spec
contexts: [delivery]
state: partial
code:
  - grill-room/app/components/output/spec-section.tsx
---

# Read the spec quickly

The owner reviews the spec inside the app without exporting it.[^founding] After a long grill nobody reads the whole spec, so Pipe wants 5 to 10 bullets on top (who can do what, the platform, the payment model) with the full spec below.[^meeting]

**Technical level.** A summary in plain words matters most to an owner who will not read implementation and testing decisions.

**Missing.** The spec is rendered in the app, but has no summary: the template's seven sections are all it holds.

[^founding]: Founding spec, stories 62 ([fragment](/_fragments/2026-09-21-0639-founding-spec/fragment.md)).
[^meeting]: Pipe in the meeting of 2026-09-29: "The spec is not read" ([fragment](/_fragments/2026-09-29-2130-pipe-meeting/fragment.md)).
