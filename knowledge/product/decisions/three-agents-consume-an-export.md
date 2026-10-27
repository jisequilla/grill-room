---
type: Decision
title: Three agents consume an export
description: The agents Grill Room writes for are three roles, the Orchestrating agent, the Build agent and the Review agent, because each reads different files for a different goal.
tags: [roles, agents]
status: draft
generated:
  by: claude-code/claude-opus-5-5
  at: 2026-10-16T13:00:00+02:00
sources:
  - id: roles
    resource: /_fragments/2026-10-16-session-roles/fragment.md
    title: Session that distilled the roles
  - id: review
    resource: /_fragments/2026-09-25-pipe-export-review/fragment.md
    title: Pipe's review of an exported bundle
# ── decision ─────────────────────────
date: 2026-10-16
decided_by: [Jeremias De Isequilla]
state: in force
---

# Three agents consume an export

An exported bundle has three agent readers, each its own role:[^roles]

- the [Orchestrating agent](/product/roles/orchestrating-agent.md) runs the build from HANDOFF.md;
- the [Build agent](/product/roles/build-agent.md) implements one ticket inside its brief;
- the [Review agent](/product/roles/review-agent.md) tries to break one change against the spec, without the builder's report.

Why: the builder and the reviewer read different files and want opposite things, and Pipe's review already treats the reviewer as separate.[^review] The owner raised the reviewer when only the builder and the orchestrator had been proposed.[^roles]

Grill Room's own agents (the interviewer, the scouts) are not roles: they are part of the product and belong among its concepts. The ticket-level pre-flight agent is left [open](../questions/is-the-pre-flight-agent-a-role.md).

[^roles]: Session of 2026-10-16 that distilled the roles ([fragment](/_fragments/2026-10-16-session-roles/fragment.md)).
[^review]: Pipe's review, "Review protocol" ([fragment](/_fragments/2026-09-25-pipe-export-review/fragment.md)).
