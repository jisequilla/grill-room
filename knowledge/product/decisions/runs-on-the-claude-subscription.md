---
type: Decision
title: Grill Room runs on the owner's Claude subscription
description: Every call Grill Room makes to Claude goes through the Claude Code command line on the owner's own subscription, with no API key, and the app says plainly when that command line is missing or logged out.
tags: [founding, claude, setup]
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

# Grill Room runs on the owner's Claude subscription

Grill Room calls Claude only through the Claude Code command line (`claude -p`), logged in to the owner's subscription, so it needs no API key and costs nothing beyond the subscription. When the command line is missing or not logged in, the app says which, with what to do about it, instead of failing silently.[^founding]

Today every call the app makes works this way: the command line is spawned in `grill-room/server/interviewer/claude-cli.ts:92`, and the app's own code holds no API key. The two setup failures each have a message and a hint (`grill-room/app/i18n/en-US.ts:364`). The framework Grill Room is built on still ships a key-based chat and its provider packages, unused by the app.[^session]

Why: Grill Room is the owner's own local tool, and the subscription they already pay for is enough to run it. In the spec's words, "so that I need no API key and pay nothing extra".[^founding]

[^founding]: Founding spec of Grill Room ([fragment](/_fragments/2026-09-21-0639-founding-spec/fragment.md)).
[^session]: Session of 2026-10-26 on the founding decisions, which checked each against the code ([fragment](/_fragments/2026-10-26-session-founding-decisions/fragment.md)).
