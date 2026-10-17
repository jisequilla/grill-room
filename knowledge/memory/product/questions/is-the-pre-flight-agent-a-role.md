---
type: Open question
title: Is the pre-flight agent a role?
description: The repository runs a pre-flight agent that reads each ticket against the code before launch, and HANDOFF.md asks for one, but no fragment records it yet.
tags: [roles, agents, pre-flight]
status: draft
generated:
  by: claude-code/claude-opus-5-5
  at: 2026-10-16T13:00:00+02:00
sources:
  - id: roles
    resource: /_fragments/2026-10-16-session-roles/fragment.md
    title: Session that distilled the roles
# ── memory ───────────────────────────
date: 2026-10-16
state: open
held_by: Jeremias De Isequilla
---

# Is the pre-flight agent a role?

Before a ticket launches, a pre-flight agent reads it against the code for wrong premises, ambiguities and owner decisions. This repository runs one, and HANDOFF.md asks the [Orchestrating agent](/product/roles/orchestrating-agent.md) to run one too. None of the bundle's fragments records it, so it was left out of the [three agent roles](../decisions/three-agents-consume-an-export.md).[^roles]

It closes once a fragment shows what the pre-flight agent needs from an export, and whether that differs enough from the Review agent to be its own role.

Not to be confused with what Pipe calls the preflight: the check before the grill starts.[^roles]

[^roles]: Session of 2026-10-16 that distilled the roles ([fragment](/_fragments/2026-10-16-session-roles/fragment.md)).
