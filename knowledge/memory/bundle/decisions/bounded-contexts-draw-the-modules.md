---
type: Decision
title: Bounded contexts draw the bundle's modules
description: Strategic domain-driven design sets the bundle's boundaries, one module per bounded context of Grill Room, drawn from where its words change meaning; tactical design stays out of the bundle.
tags: [ddd, bounded-context, modules]
status: draft
generated:
  by: claude-code/claude-opus-5-5
  at: 2026-10-17T14:00:00+02:00
sources:
  - id: ddd
    resource: /_fragments/2026-10-17-session-ddd-boundaries/fragment.md
    title: Session that chose DDD for the bundle's boundaries
# ── memory ───────────────────────────
date: 2026-10-17
decided_by: [Jeremias De Isequilla]
state: in force
---

# Bounded contexts draw the bundle's modules

Each bounded context of Grill Room is one module of this bundle, with its own language and its own decisions. A context is drawn where a word changes meaning, not where a feature or a screen ends. Roles and use cases cut across contexts; each use case names the contexts it crosses, and together they form the context map.[^ddd]

The bundle stays at the strategic level: contexts, their language and the map. Aggregates, entities and other tactical design belong to the code.[^ddd]

The contexts are drawn before the Pipe grill, so that its decisions land in the right one.[^ddd]

Why: OKF gives the bundle layers but no boundaries, and the repository shows contexts that were never drawn: "proposal" carries four meanings in `GLOSSARY.md`, "preflight" two, and the specs named three or four roles ten ways. In the owner's words: "we should use DD Domain Dreaven Design principles to druve our knowledge boundries and bounded scope".[^ddd]

[^ddd]: Session of 2026-10-17 that chose DDD for the bundle's boundaries ([fragment](/_fragments/2026-10-17-session-ddd-boundaries/fragment.md)).
