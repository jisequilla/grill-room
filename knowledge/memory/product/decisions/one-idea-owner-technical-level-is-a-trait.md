---
type: Decision
title: One Idea owner, with technical level as a trait
description: Grill Room serves one human role, the Idea owner, whose technical level ranges from technical to not; use cases say when the level changes the outcome, instead of splitting the role.
tags: [roles, technical-level]
status: draft
generated:
  by: claude-code/claude-opus-5-5
  at: 2026-10-16T13:00:00+02:00
sources:
  - id: roles
    resource: /_fragments/2026-10-16-session-roles/fragment.md
    title: Session that distilled the roles
  - id: meeting
    resource: /_fragments/2026-09-29-2130-pipe-meeting/fragment.md
    title: Meeting with Pipe on Grill Room's user experience
# ── memory ───────────────────────────
date: 2026-10-16
decided_by: [Jeremias De Isequilla]
state: in force
---

# One Idea owner, with technical level as a trait

The five names specs gave the person who grills (user, session creator, session owner, owner, operator) are one role, the [Idea owner](/product/roles/idea-owner.md). Technical level is a trait of that role, not a second role: a technical and a non-technical owner want the same outcome, calibrated differently.[^roles]

Why: Grill Room was built for its technical end. Its second real user is not technical and asked to be asked about it first.[^meeting] Splitting the role would duplicate most use cases; a trait keeps one use case and names where the level changes it.

[^roles]: Session of 2026-10-16 that distilled the roles ([fragment](/_fragments/2026-10-16-session-roles/fragment.md)).
[^meeting]: Pipe in the meeting of 2026-09-29, asking to be asked his technical level first ([fragment](/_fragments/2026-09-29-2130-pipe-meeting/fragment.md)).
