---
type: Term
title: Repo decision
description: A decision the repository already holds, recorded in its decisions.md files or inferred from its code, carried into a session as settled.
tags: [term, project-knowledge]
status: draft
generated:
  by: claude-code/claude-opus-5-5
  at: 2026-10-19T12:00:00+02:00
sources:
  - id: contexts
    resource: /_fragments/2026-10-19-session-contexts/fragment.md
    title: Session that drew the bounded contexts
# ── project-knowledge ───────────────────────────
avoid:
  - inherited decision
code:
  - grill-room/server/db/schema.ts:393
  - grill-room/server/decisions-file.ts:1
---

# Repo decision

Once kept, it lives as an Interview [decision](/interview/language/decision.md) with the scout's provenance on it. decisions.md files written by earlier exports are read back here, so a past delivery feeds the next interview.[^contexts]

[^contexts]: Placed in this context by the session that drew the bounded contexts, from the vocabulary inventory it records ([fragment](/_fragments/2026-10-19-session-contexts/fragment.md)).
