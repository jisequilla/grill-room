---
type: Role
title: Orchestrating agent
description: The Idea owner's own agent session that takes an exported bundle and runs the build from HANDOFF.md, launching, reviewing and merging tickets and logging what happened.
tags: [role, agent]
status: draft
generated:
  by: claude-code/claude-opus-5-5
  at: 2026-10-16T13:00:00+02:00
sources:
  - id: founding
    resource: /_fragments/2026-09-21-0639-founding-spec/fragment.md
    title: Founding spec of Grill Room
  - id: meeting
    resource: /_fragments/2026-09-29-2130-pipe-meeting/fragment.md
    title: Meeting with Pipe on Grill Room's user experience
# ── product ───────────────────────────
also_called: [orchestrator]
---

# Orchestrating agent

Grill Room's part ends when the bundle is delivered; the build runs in the Idea owner's own agent session.[^meeting] That session is the Orchestrating agent. It reads HANDOFF.md, launches each ticket's [Build agent](build-agent.md), sends the result to a [Review agent](review-agent.md), merges what passes, and [writes a build record](/product/use-cases/build/record-a-build-outcome.md) back to Grill Room from the command line or over HTTP, without the browser.[^founding]

It is the only agent in the founding spec.[^founding]

[^founding]: Story 78: "As an orchestrating agent, I want to write a build record through a command-line or HTTP call, so that I can log results without using the browser" ([fragment](/_fragments/2026-09-21-0639-founding-spec/fragment.md)).
[^meeting]: Granola's summary of the meeting: "Grill Room's role ends at package delivery; execution happens in the user's own Claude session" ([fragment](/_fragments/2026-09-29-2130-pipe-meeting/fragment.md)).
