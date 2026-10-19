---
type: Use case
title: Get a spec from the settled decisions
description: Once confirmed, the Idea owner gets a spec in the upstream to-spec format, honest about what is out of scope and still open, and regenerable when decisions change.
tags: [use-case, spec]
status: draft
generated:
  by: claude-code/claude-opus-5-5
  at: 2026-10-16T14:00:00+02:00
sources:
  - id: founding
    resource: /_fragments/2026-09-21-0639-founding-spec/fragment.md
    title: Founding spec of Grill Room
# ── product ───────────────────────────
role: /product/roles/idea-owner.md
stage: spec
contexts: [delivery, interview]
state: built
code:
  - grill-room/actions/synthesize-spec.ts:25
  - grill-room/server/interviewer/prompt.ts:465
---

# Get a spec from the settled decisions

The spec follows the to-spec template's sections, with an extensive list of user stories and no file paths or code. Loose ends set out of scope land in its out-of-scope section, kept open questions in its further notes. It works for an idea with no code, and is regenerated after decisions change.[^founding]

[^founding]: Founding spec, stories 56-61, 63-64 ([fragment](/_fragments/2026-09-21-0639-founding-spec/fragment.md)).
