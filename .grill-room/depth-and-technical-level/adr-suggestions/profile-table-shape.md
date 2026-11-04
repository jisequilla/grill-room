# Where the level sits relative to the Better Auth user

Suggested by Grill Room from the session "Depth and technical level before the grill". Copy it into the repo's own ADR folder, in its own convention and numbering, then set its status there. This file is a working file: it is deleted with the rest of this folder.

- **Status:** Proposed
- **Decision key:** `profile-table-shape`

## Context

The owner is now the signed-in Better Auth user. The technical level can live in a separate profile table keyed by the user id, or as a column added to the auth user table itself.

## Decision

Separate owner profile table keyed by the auth user id

## Alternatives

- Column on the Better Auth user table: No join, no lazy creation. Costs editing a table the framework owns, which its schema generator may overwrite or fight on upgrade.

## Consequences

Commits the schema to an owner_profiles table with the auth user id as its key and sessions referencing that user id. Rules out app fields on Better Auth tables and makes every level read a join or a second query.

## Tickets

- [01 Owner profile table, session owner reference, depth columns and migration](../issues/01-owner-profile-schema-and-session-columns.md)
- [08 Record the decisions in the knowledge bundle and an ADR](../issues/08-knowledge-bundle-and-adr.md)
