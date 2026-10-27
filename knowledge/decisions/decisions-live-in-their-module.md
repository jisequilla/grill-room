---
type: Decision
title: Decisions live in the module they decide
description: Each decision and open question sits in the module it is about, next to that module's language or use cases; the decisions about the bundle itself sit at its root, and there is no memory module.
tags: [modules, decisions]
status: draft
generated:
  by: claude-code/claude-opus-5-5
  at: 2026-10-26T12:00:00+01:00
sources:
  - id: founding
    resource: /_fragments/2026-10-26-session-founding-decisions/fragment.md
    title: Session on the founding decisions and where decisions live
# ── decision ─────────────────────────
date: 2026-10-26
decided_by: [Jeremias De Isequilla]
state: in force
---

# Decisions live in the module they decide

A decision or open question about a bounded context lives in that context's module, in `decisions/` or `questions/`; one about the product, its roles or use cases, lives in `product/`. A decision about the bundle itself lives in the root [`decisions/`](index.md), since no module owns it. The types are common to every module, in the root manifest.[^founding]

This replaces the memory module the bundle started with in [Capture Grill Room in a minimal OKF bundle](capture-grill-room-in-a-minimal-okf-bundle.md), and carries out what [Bounded contexts draw the bundle's modules](bounded-contexts-draw-the-modules.md) already said: each context has "its own language and its own decisions".

Why: a module of every decision groups knowledge by its type rather than by its domain, so a product decision sat away from the product and an interview decision away from the interview. In the owner's words: "i am questioning the memory domeain, i think this is an anti pattern".[^founding]

[^founding]: Session of 2026-10-26 on the founding decisions ([fragment](/_fragments/2026-10-26-session-founding-decisions/fragment.md)).
