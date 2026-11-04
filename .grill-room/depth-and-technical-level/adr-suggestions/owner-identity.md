# How an owner is identified for the profile table

Suggested by Grill Room from the session "Depth and technical level before the grill". Copy it into the repo's own ADR folder, in its own convention and numbering, then set its status there. This file is a working file: it is deleted with the rest of this folder.

- **Status:** Proposed
- **Decision key:** `owner-identity`

## Context

You chose a new owner profile table that sessions reference. Grill Room has no accounts, so something has to say which owner a new session belongs to and when 'first setup' happens. How is the owner identified?

## Decision

Real sign-in (accounts) backing the profile. The agent-native framework already ships Better Auth login/signup, enabled unless AUTH_DISABLED is set, so the profile row keys off the signed-in user; no new authentication layer is built.

## Alternatives

- One implicit owner per deployment: a single profile row, created on first launch: Simplest possible identity; first setup is literally the first time the app opens. Costs the case where two people share one deployment, who would then share one technical level.
- Named owners picked at session creation, no password: Lets the technical and the non-technical owner use the same deployment with their own levels, and 'first setup' is the first session under a new name. Costs a picker on session creation and a profile row that anyone can select.
- Real sign-in (accounts) backing the profile: The trait finally has a durable, private home. Costs an authentication layer the app has never needed, for a single stored field today.

## Consequences

Commits the schema to an owners table keyed by a chosen name and a nullable owner reference on sessions, with no authentication. Rules out treating the level as private, and makes adding real accounts later a migration of owners rather than a fresh start.

## Tickets

- [02 Resolve the current owner and hand local sessions and level to the inheriting user](../issues/02-current-owner-and-migrated-inheritance.md)
