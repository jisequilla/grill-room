---
type: Decision
title: Private material is paraphrased, never quoted, in git
description: What someone other than the owner said in private material that stays out of git reaches the bundle's committed files only as paraphrase.
tags: [privacy, fragments, public-repo]
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

# Private material is paraphrased, never quoted, in git

When a fragment's material stays out of git (`in_git: false`), the words of the people in it reach committed files only as paraphrase: cards, roles, decisions, use cases and session records say what was meant, not what was said, and do not point at line numbers in the material. The owner's own words in session records are still quoted literally.[^ddd]

Why: the repository is public. Before the first commit, four files quoted Pipe's private meeting word for word; the owner chose to paraphrase them.[^ddd]

[^ddd]: Session of 2026-10-17 that chose DDD for the bundle's boundaries ([fragment](/_fragments/2026-10-17-session-ddd-boundaries/fragment.md)).
