---
type: Decision
title: Technical level lives on the signed-in owner's profile
description: The Idea owner is the signed-in Better Auth user; their technical level lives in a separate owner profile that sessions reference and read live, with a fixed local owner when login is off.
tags: [technical-level, owner, auth, migration]
status: draft
generated:
  by: claude-code/claude-opus-5-5
  at: 2026-11-04T18:00:00+01:00
sources:
  - id: depth
    resource: /_fragments/2026-11-04-session-depth-and-level/fragment.md
    title: Session on depth and technical level before the grill
  - id: trait
    resource: /product/decisions/one-idea-owner-technical-level-is-a-trait.md
    title: One Idea owner, with technical level as a trait
# ── decision ─────────────────────────
date: 2026-11-04
decided_by: [Jeremias De Isequilla]
state: in force
---

# Technical level lives on the signed-in owner's profile

The [Idea owner](/product/roles/idea-owner.md) is the user signed in through the Better Auth login the framework already ships; no other authentication is built. Their [technical level](/interview/language/technical-level.md) lives in a separate owner profile table keyed by the auth user id, never on the framework's own tables. Sessions reference the owner and carry no level of their own: the level is read live, and a change made mid-session writes to the profile.[^depth]

With `AUTH_DISABLED`, a fixed local owner is used, and that same row is the migration placeholder that existing sessions are assigned to. Once login is on, the first user who signs in inherits the placeholder's sessions once, along with its level if theirs is empty. Sessions created later under the local owner go to that same user.[^depth]

Why: the trait describes the person, and two people now use Grill Room, so it needs a home that tells them apart. The framework already has accounts, so a profile keyed by the user is cheaper than it looked. Keeping app fields off the framework's tables means its upgrades and migrations never collide with them.[^depth] It applies the [one-owner-with-a-trait](/product/decisions/one-idea-owner-technical-level-is-a-trait.md) decision.[^trait]

[^depth]: Session on depth and technical level before the grill, choices 2, 8, 14, 16-18, 21, 29, 30 and 35 ([fragment](/_fragments/2026-11-04-session-depth-and-level/fragment.md)).
[^trait]: [One Idea owner, with technical level as a trait](/product/decisions/one-idea-owner-technical-level-is-a-trait.md).
