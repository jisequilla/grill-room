---
type: Decision
title: The interviewer cannot touch the owner's machine
description: The interviewer runs with no tool that can run a command or change a file, so that running an interview is safe; at most it reads the docs folder the owner points it to.
tags: [founding, interviewer, safety]
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

# The interviewer cannot touch the owner's machine

The interviewer can run no commands and change no files. Without a docs folder it has no tools at all (`--allowed-tools ""`, `grill-room/server/interviewer/claude-cli.ts:259`). When the owner gives a session a docs folder, it may read that folder with Read, Grep and Glob, and nothing else.[^founding][^session]

The same holds for Grill Room's other agents: the scouts read a registered project's files with the same three tools, with secret files denied (`grill-room/server/interviewer/claude-cli.ts:213`). No call can run a command or write.[^session]

Why: the interviewer is driven by text the owner types, and an interview should never be a way to act on the machine. In the spec's words, "so that running an interview is safe".[^founding]

[^founding]: Founding spec of Grill Room ([fragment](/_fragments/2026-09-21-0639-founding-spec/fragment.md)).
[^session]: Session of 2026-10-26 on the founding decisions, which checked each against the code ([fragment](/_fragments/2026-10-26-session-founding-decisions/fragment.md)).
