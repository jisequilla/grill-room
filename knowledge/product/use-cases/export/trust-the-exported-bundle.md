---
type: Use case
title: Trust the exported bundle
description: "What the export states is only what was checked and settled: no replaced decision reads as live, no raw answer reaches an agent, no verdict is stale, no repository fact is assumed."
tags: [use-case, export]
status: draft
generated:
  by: claude-code/claude-opus-5-5
  at: 2026-10-16T14:00:00+02:00
sources:
  - id: review
    resource: /_fragments/2026-09-25-pipe-export-review/fragment.md
    title: Pipe's review of an exported bundle
# ── product ───────────────────────────
role: /product/roles/idea-owner.md
stage: export
contexts: [delivery]
state: built
code:
  - grill-room/server/export.ts:755
  - grill-room/server/export.ts:903
  - grill-room/server/export-bundle.ts:952
  - grill-room/server/handoff.ts:1737
  - grill-room/server/handoff.ts:406
  - grill-room/server/handoff.ts:1361
---

# Trust the exported bundle

Pipe judged the trail and briefs strong and the export not: it presented superseded decisions as live, passed raw answers through, kept a stale readiness verdict and assumed facts about a repository that had none.[^review] Today decisions.md leaves out what is unsettled or withdrawn and marks supersession, operator notes are kept apart from the answer, the readiness section says when it was not judged for this version of the idea, and a repository with no commits is described as greenfield.

Pipe also found every brief assuming a verify command the repository did not have, each brief copying its ticket so the two could drift, and one build-record command per ticket.[^review] Today, in a repository with no commits, ticket 1 sets up the verify command as part of its acceptance and every other brief says it is established by ticket 1. A change to a ticket blocks the export until the handoff is regenerated, which rewrites every brief not edited by hand and lists the edited ones whose ticket moved on. HANDOFF.md gives one build-record command for every ticket.

Built through epic `gr-ibp`; Pipe has not yet validated it on a fresh bundle (`gr-ibp.10`).

[^review]: Pipe's review: export defects 1-7 and the checklist ([fragment](/_fragments/2026-09-25-pipe-export-review/fragment.md)).
