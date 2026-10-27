---
type: Decision
title: Grill Room has three bounded contexts
description: Interview is the core context; Project knowledge and Delivery support it; interviewer turn bookkeeping is a generic subdomain outside the bundle.
tags: [ddd, bounded-context]
status: draft
generated:
  by: claude-code/claude-opus-5-5
  at: 2026-10-19T12:00:00+02:00
sources:
  - id: contexts
    resource: /_fragments/2026-10-19-session-contexts/fragment.md
    title: Session that drew the bounded contexts
# ── decision ─────────────────────────
date: 2026-10-19
decided_by: [Jeremias De Isequilla]
state: in force
---

# Grill Room has three bounded contexts

Grill Room's knowledge divides into three bounded contexts, each a module of this bundle; the [context map](/context-map.md) says how they relate.[^contexts]

- **Interview**, the core: what makes Grill Room what it is.
- **Project knowledge**, supporting: what the target repository already says.
- **Delivery**, supporting: what turns settled decisions into built work. The project's delivery settings are its language, though they are stored on the project.

Interviewer turns, runs and attempts are a generic technical subdomain and stay out of the bundle.[^contexts]

Why: the vocabulary inventory found nine clusters of related terms, and the words that change meaning between them sort cleanly into these three, except two meanings of "proposal" inside Interview, left [open](/interview/questions/two-proposals-in-the-interview.md). The owner chose these three over a fourth Specification context.[^contexts]

[^contexts]: Session that drew the bounded contexts ([fragment](/_fragments/2026-10-19-session-contexts/fragment.md)).
