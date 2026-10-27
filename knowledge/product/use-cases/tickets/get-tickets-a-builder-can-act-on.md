---
type: Use case
title: Get tickets a builder can act on without guessing
description: The Idea owner gets tickets that leave the Build agent nothing to guess, with grounded file boundaries, flagged open choices, stories traced to tickets, outside prerequisites as gates and a plan shaped for parallel work.
tags: [use-case, tickets]
status: draft
generated:
  by: claude-code/claude-opus-5-5
  at: 2026-10-27T10:00:00+01:00
sources:
  - id: review
    resource: /_fragments/2026-09-25-pipe-export-review/fragment.md
    title: Pipe's review of an exported bundle
  - id: session
    resource: /_fragments/2026-10-26-session-founding-decisions/fragment.md
    title: Session on the founding decisions and where decisions live
# ── product ───────────────────────────
role: /product/roles/idea-owner.md
stage: tickets
contexts: [delivery, project-knowledge]
state: partial
code:
  - grill-room/actions/ground-briefs.ts:158
  - grill-room/server/consistency.ts:471
  - grill-room/server/tickets.ts:855
  - grill-room/server/tickets.ts:207
  - grill-room/server/handoff.ts:976
---

# Get tickets a builder can act on without guessing

Pipe found the tickets leaving the hardest work to the builder: every brief's file boundaries and codebase facts were empty, a ticket left "Checkout or Payment Element" open, a timeout was "defined" but never given, no ticket cited the stories it implements, the accounts and legal steps a launch needs sat outside the waves, and nothing sized the plan against the time to build it.[^review]

Today:

- A handoff scout reads the project and fills each brief's file boundaries and codebase facts, citing the code, once the owner grounds the briefs; until then the slots are empty and HANDOFF.md says to fill them.
- After the tickets are drawn, a check flags any open "X or Y", any value called defined but not given, and four other ways a ticket leaves the builder to decide. Its findings are advisory, shown in HANDOFF.md and in the brief of each ticket they quote, and answering one adds it to the interview as a new decision.
- When the spec numbers its stories, every build ticket that cites one must cite a real one, and HANDOFF.md lists the stories no ticket implements.
- An outside prerequisite becomes a gate ticket that says what it waits for and who provides it, and every ticket that needs it is blocked by it.
- HANDOFF.md shows the longest chain of tickets, how many can run in each wave and how many to run at a time. Hours per week and a deadline were dropped: an agent-run build is limited by tokens, the rate limit and the orchestrator's attention, not by hours (bead `gr-ibp.9`).[^session]

**Missing.** Spec rules are not numbered, so a ticket cannot cite one, and a build ticket may cite no story at all, such as one that only sets things up.

[^review]: Pipe's review, "Interview depth gaps" ([fragment](/_fragments/2026-09-25-pipe-export-review/fragment.md)).
[^session]: Session of 2026-10-26, which placed the review's depth gaps in this use case ([fragment](/_fragments/2026-10-26-session-founding-decisions/fragment.md)).
