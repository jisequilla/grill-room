---
type: Decision
title: Everything stays on the owner's machine
description: Grill Room is a single-user local tool that serves only its own machine, with no login screen, and keeps its data in a local embedded database, so nothing leaves the machine except the calls to Claude.
tags: [founding, local, privacy]
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

# Everything stays on the owner's machine

Grill Room serves one person on their own machine. It answers only on localhost, with no login screen, and keeps every session in a local embedded database, so the only thing that leaves the machine is the calls to Claude.[^founding]

The data half holds: the database is PGlite in the app's data folder by default, and the app's own code makes no network call except through the Claude command line. A `DATABASE_URL` can point it elsewhere, but nothing does by default.[^session]

The localhost half is broken today (`gr-3u9i`). The development server listens on every network interface, and the local setup turns the login off, so while it runs anyone on the same network can use the app, including the scouts that read the registered projects. The decision stands; the code is to be brought back to it.[^session]

Why: a single-user local tool needs no ceremony, and the ideas grilled in it are the owner's own. In the spec's words, "so that a single-user local tool has no ceremony" and "so that nothing leaves my machine except the calls to Claude".[^founding]

[^founding]: Founding spec of Grill Room ([fragment](/_fragments/2026-09-21-0639-founding-spec/fragment.md)).
[^session]: Session of 2026-10-26 on the founding decisions, which checked each against the code ([fragment](/_fragments/2026-10-26-session-founding-decisions/fragment.md)).
