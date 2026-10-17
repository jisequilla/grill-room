---
type: Role
title: Build agent
description: The agent that implements one ticket from its brief, inside the brief's boundaries, and stops at a draft pull request.
tags: [role, agent]
status: draft
generated:
  by: claude-code/claude-opus-5-5
  at: 2026-10-16T13:00:00+02:00
sources:
  - id: founding
    resource: /_fragments/2026-09-21-0639-founding-spec/fragment.md
    title: Founding spec of Grill Room
  - id: review
    resource: /_fragments/2026-09-25-pipe-export-review/fragment.md
    title: Pipe's review of an exported bundle
# ── product ───────────────────────────
also_called: [builder]
---

# Build agent

The Build agent takes one ticket, sized so that one agent can complete it,[^founding] and builds it from its brief. The brief keeps it inside one worktree, stops it if the files it builds on are missing, allows only a draft pull request, and ends with report, then stop.[^review]

It reads what the export writes for it, decisions.md included, so anything in those files that is not meant for an agent misleads it.[^review]

[^founding]: Story 68: "I want tickets sized so that one agent can complete one ticket, so that delegation is straightforward" ([fragment](/_fragments/2026-09-21-0639-founding-spec/fragment.md)).
[^review]: Pipe's review, "Safe delegation briefs" and finding 2: "Build agents read this file" ([fragment](/_fragments/2026-09-25-pipe-export-review/fragment.md)).
