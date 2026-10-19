---
type: Index
title: Grill Room knowledge
description: The bundle that answers what Grill Room does today, for whom, and why, so specs are projected from settled knowledge instead of written straight from a grill.
tags: [okf, grill-room]
status: draft
generated:
  by: claude-code/claude-opus-5-5
  at: 2026-10-16T12:00:00+02:00
---

# Grill Room knowledge

**Question:** What does Grill Room do today, for whom, and why?

Knowledge lives in three layers:

- [`_fragments/`](_fragments/index.md) holds what arrived: verbatim and never edited, each with a card that says what it is.
- The modules hold what we understand now, in the present tense, each fact citing the fragments it rests on. Their boundaries are Grill Room's bounded contexts, drawn in the [context map](context-map.md):
  - [`interview/`](interview/index.md), the core context, and [`project-knowledge/`](project-knowledge/index.md) and [`delivery/`](delivery/index.md), supporting it: each holds its ubiquitous language in `language/`, one Term per word, the canonical vocabulary.
  - [`product/`](product/index.md): the roles Grill Room serves and their use cases, which cut across the contexts.
  - [`memory/`](memory/index.md): what was decided, per context, about the product and about this bundle, and what is still open.
- Projections (specs, briefs) are derived from the modules for a reader. There are none yet.

The bundle grows only by need: a new type, module, tool or projection enters after it has been debated and grilled. [`manifest.yaml`](manifest.yaml) lists what is deliberately not here yet.
