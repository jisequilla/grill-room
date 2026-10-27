---
type: Decision
title: The grilling skill is the method, unmodified
description: The interviewer is driven by the original grilling skill text, byte for byte; what Grill Room adds is how the app runs it, appended after the skill and never woven into it.
tags: [founding, interviewer, grilling]
status: draft
generated:
  by: claude-code/claude-opus-5-5
  at: 2026-10-27T10:00:00+01:00
sources:
  - id: founding
    resource: /_fragments/2026-09-21-0639-founding-spec/fragment.md
    title: Founding spec of Grill Room
  - id: session
    resource: /_fragments/2026-10-26-session-founding-decisions/fragment.md
    title: Session on the founding decisions and where decisions live
# ── decision ─────────────────────────
date: 2026-09-21
decided_by: [Jeremias De Isequilla]
state: in force
---

# The grilling skill is the method, unmodified

The interviewer's instructions start with the grilling skill exactly as published, a copy a test keeps byte-identical to the repository's own (`grill-room/server/interviewer/instructions.test.ts:26`). Grill Room is a container for that method, not a reinterpretation of it.[^founding][^session]

What the app needs is added after the skill, in a separate section (`grill-room/server/interviewer/instructions.ts:127`): answers come back as structured data, the interviewer uses no tools, every question names what it depends on, nothing is asked before what it depends on is settled, each card offers choices with a recommendation, and supersession is proposed sparingly. A session with a docs folder adds how to read it. These change how the method is delivered, not the method.[^session]

Why: the experiment is whether the method works better in a structured workspace than in a chat window, which can only be judged if the method is the same. In the spec's words, "so that the app is a faithful container for the method rather than a reinterpretation".[^founding]

[^founding]: Founding spec of Grill Room ([fragment](/_fragments/2026-09-21-0639-founding-spec/fragment.md)).
[^session]: Session of 2026-10-26 on the founding decisions, which checked each against the code ([fragment](/_fragments/2026-10-26-session-founding-decisions/fragment.md)).
