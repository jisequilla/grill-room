---
type: Use case
title: Scope how deep to grill
description: Before the grill, the Idea owner says how deep to go, from a quick proof of concept to a full spec, and how technical they are, so the interview fits both.
tags: [use-case, readiness]
status: draft
generated:
  by: claude-code/claude-opus-5-5
  at: 2026-10-16T14:00:00+02:00
sources:
  - id: meeting
    resource: /_fragments/2026-09-29-2130-pipe-meeting/fragment.md
    title: Meeting with Pipe on Grill Room's user experience
  - id: depth
    resource: /_fragments/2026-11-04-session-depth-and-level/fragment.md
    title: Session on depth and technical level before the grill
# ── product ───────────────────────────
role: /product/roles/idea-owner.md
stage: readiness
contexts: [interview]
state: wanted
code: []
---

# Scope how deep to grill

Pipe wants the step before the grill to be a short grill of its own: how big do you want to go, a quick proof of concept or a full spec, and are you technical, asked once at first setup. The interviewer then pitches its questions to that depth and that level.[^meeting]

**Decided.** [Depth](/interview/language/depth.md) is asked per session, and the [technical level](/interview/language/technical-level.md) once per owner and shown pre-filled at every session, both in a setup step at session creation before readiness ([depth per session](/interview/decisions/depth-is-chosen-per-session.md)). The level lives on the signed-in owner's profile ([where it lives](/product/decisions/technical-level-lives-on-the-signed-in-owner.md)). The interviewer pitches its branches, done point, wording and recommendations to both ([how the interview adapts](/interview/decisions/the-interview-is-pitched-to-depth-and-level.md)), and the spec check scales to depth ([downstream](/delivery/decisions/depth-sets-the-spec-checks-bar.md)).[^depth] The bundle to build it is `docs/specs/depth-and-technical-level/`.

**Technical level.** This use case is where the trait is captured; every later use case that adapts to the level reads it from the owner's profile.

**Missing.** Not built yet: nothing in the session, the schema or the interviewer's instructions records a depth or a technical level.

[^meeting]: Pipe in the meeting of 2026-09-29: "Depth before the grill" ([fragment](/_fragments/2026-09-29-2130-pipe-meeting/fragment.md)).
[^depth]: Session on depth and technical level before the grill ([fragment](/_fragments/2026-11-04-session-depth-and-level/fragment.md)).
