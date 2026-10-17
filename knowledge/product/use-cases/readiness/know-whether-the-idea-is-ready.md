---
type: Use case
title: Know whether the idea is ready, and what to do if not
description: Before the first round, the Idea owner learns whether the idea holds enough to grill and, when it does not, gets clear ways forward.
tags: [use-case, readiness]
status: draft
generated:
  by: claude-code/claude-opus-5-5
  at: 2026-10-16T14:00:00+02:00
sources:
  - id: meeting
    resource: /_fragments/2026-09-29-2130-pipe-meeting/fragment.md
    title: Meeting with Pipe on Grill Room's user experience
# ── product ───────────────────────────
role: /product/roles/idea-owner.md
stage: readiness
state: partial
code:
  - grill-room/app/components/workspace/readiness-panel.tsx:61
  - grill-room/app/i18n/en-US.ts:248
  - grill-room/actions/assess-readiness.ts
---

# Know whether the idea is ready, and what to do if not

The interviewer judges the idea ready or not ready and says what it found and what is missing. A not-ready verdict leaves Pipe stuck: he does not know that editing the idea is the way out. He wants three ways forward: edit the idea, answer a few targeted questions, or confirm it as is and proceed.[^meeting]

**Technical level.** A non-technical owner is the one most likely to be not ready and least likely to know what is missing; the ways forward matter most to them.

**Missing.** The not-ready panel lists objective, evidence, unknowns and what is missing, and offers only Re-assess; editing the idea is a separate control, and the copy says it only warns. There is no targeted-questions path and no explicit confirm-and-proceed.

[^meeting]: Pipe in the meeting of 2026-09-29: "The 'not ready' state" ([fragment](/_fragments/2026-09-29-2130-pipe-meeting/fragment.md)).
