# Where the owner's technical level is stored

Suggested by Grill Room from the session "Depth and technical level before the grill". Copy it into the repo's own ADR folder, in its own convention and numbering, then set its status there. This file is a working file: it is deleted with the rest of this folder.

- **Status:** Proposed
- **Decision key:** `level-storage`

## Context

The schema has sessions with readiness JSON but the scout found no owner record. 'Asked once at first setup' needs somewhere to keep the answer across sessions. Does an owner or profile record exist, and if not, what carries the level?

## Decision

New owner profile table; sessions reference it

## Alternatives

- Stored on each session, pre-filled from the owner's last session: No new entity: the newest session's value is the owner's current level. Costs a lookup at session creation and a trait that technically lives in many rows.
- Kept in the client (local storage) and sent with each session: Zero schema change beyond a session column. Costs loss on a new device or cleared browser, and the server cannot reason about it without the session copy.

## Consequences

Commits depth and level to columns on the sessions table next to readiness, with the server reading the previous session to pre-fill level. Rules out a per-owner entity for now; if accounts are added later, the level must be lifted out of sessions.

## Tickets

- [01 Owner profile table, session owner reference, depth columns and migration](../issues/01-owner-profile-schema-and-session-columns.md)
