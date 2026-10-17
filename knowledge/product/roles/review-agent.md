---
type: Role
title: Review agent
description: A second, fresh-context agent that tries to break one ticket's change against the spec, without ever seeing the Build agent's report.
tags: [role, agent]
status: draft
generated:
  by: claude-code/claude-opus-5-5
  at: 2026-10-16T13:00:00+02:00
sources:
  - id: review
    resource: /_fragments/2026-09-25-pipe-export-review/fragment.md
    title: Pipe's review of an exported bundle
  - id: roles
    resource: /_fragments/2026-10-16-session-roles/fragment.md
    title: Session that distilled the roles
# ── product ───────────────────────────
also_called: [reviewer]
---

# Review agent

The Review agent sees the spec, the ticket, the brief and the diff, and never the [Build agent](build-agent.md)'s report: a subagent's report is a claim, not evidence.[^review] Its goal is the opposite of the builder's: to find where the change fails the spec. Each ticket gets one, for up to two review rounds.[^review]

The owner added it when the agent roles were first drawn as builder and orchestrator only.[^roles]

[^review]: Pipe's review, "Review protocol" and "No sizing against capacity" ([fragment](/_fragments/2026-09-25-pipe-export-review/fragment.md)).
[^roles]: Session of 2026-10-16 that distilled the roles ([fragment](/_fragments/2026-10-16-session-roles/fragment.md)).
