---
type: Use case
title: Record a build outcome without the browser
description: After a ticket is built, the Orchestrating agent writes its build record to Grill Room from the command line or over HTTP, using the command HANDOFF.md gives it.
tags: [use-case, build]
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
# ── product ───────────────────────────
role: /product/roles/orchestrating-agent.md
stage: build
contexts: [delivery]
state: built
code:
  - grill-room/actions/set-build-record.ts:10
  - grill-room/server/handoff.ts:1361
---

# Record a build outcome without the browser

Once a ticket is built and merged, the Orchestrating agent logs how it went: the model, whether the first attempt passed, whether it escalated and what the brief was missing. It does so from the command line or over HTTP, without opening the app.[^founding]

HANDOFF.md gives it one command to fill in for every build ticket, with the session already set, and names the gates that get no record. The same action is reachable over HTTP. The records are what the Idea owner [learns from](/product/use-cases/build/learn-from-build-outcomes.md).[^session]

[^founding]: Founding spec, story 78: "As an orchestrating agent, I want to write a build record through a command-line or HTTP call, so that I can log results without using the browser" ([fragment](/_fragments/2026-09-21-0639-founding-spec/fragment.md)).
[^session]: Session of 2026-10-26, which checked story 78 against the code ([fragment](/_fragments/2026-10-26-session-founding-decisions/fragment.md)).
