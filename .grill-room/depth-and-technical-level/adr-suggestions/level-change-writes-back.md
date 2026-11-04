# What a mid-session level change updates

Suggested by Grill Room from the session "Depth and technical level before the grill". Copy it into the repo's own ADR folder, in its own convention and numbering, then set its status there. This file is a working file: it is deleted with the rest of this folder.

- **Status:** Proposed
- **Decision key:** `level-change-writes-back`

## Context

Level lives in the owner profile and can be changed at any round. When the owner changes it two rounds in, does the change belong to the profile, to this session only, or both?

## Decision

Profile only: sessions read the profile live, no session copy

## Alternatives

- Session override column, profile untouched: A one-off change stays one-off. Costs two sources of truth and an owner who corrects a wrong level once and is asked again next session.
- Both: session takes the new value and the profile is updated: Correction propagates and the session is self-contained. Costs a write to two places and a rule for which wins when they differ.

## Consequences

Commits sessions to carrying no technical-level column; the prompt builder reads it through the owner reference every turn. Rules out per-session level exceptions without a later schema change.

## Tickets

- [04 Actions to read and change depth and level, with re-judge, queuing, done withdrawal and stale marking](../issues/04-depth-and-level-actions.md)
