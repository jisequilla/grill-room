---
type: Decision
title: Each context's ubiquitous language lives in the bundle
description: The canonical vocabulary is one Term file per word in each context module's language/ folder; glossaries for the engineering skills are generated from it, never written by hand.
tags: [ddd, ubiquitous-language, glossary]
status: draft
generated:
  by: claude-code/claude-opus-5-5
  at: 2026-10-17T14:00:00+02:00
sources:
  - id: ddd
    resource: /_fragments/2026-10-17-session-ddd-boundaries/fragment.md
    title: Session that chose DDD for the bundle's boundaries
# ── decision ─────────────────────────
date: 2026-10-17
decided_by: [Jeremias De Isequilla]
state: in force
---

# Each context's ubiquitous language lives in the bundle

Every context module holds a `language/` folder with one Term per file: what the word means in that context, the words to avoid for it, and where it lives in the code. That folder is the source of truth for the context's vocabulary. The Concept type is retired.[^ddd]

`GLOSSARY.md` at the repository root is what the engineering skills read. It becomes a `GLOSSARY-MAP.md` with one glossary per context, generated from the `language/` folders and not edited by hand. Until the generator exists, the hand-written `GLOSSARY.md` stays as it is; building the generator is a need to be debated first, like any tool in this bundle.[^ddd]

Why: a ubiquitous language, unlike a glossary, is bounded by its context and binds the code, so one word can mean one thing per context. Two hand-kept homes for the same vocabulary would drift, as the specs did. The owner asked "i think this last one has more track than glossary, what do you think?" and chose `language/` as canonical.[^ddd]

[^ddd]: Session of 2026-10-17 that chose DDD for the bundle's boundaries ([fragment](/_fragments/2026-10-17-session-ddd-boundaries/fragment.md)).
