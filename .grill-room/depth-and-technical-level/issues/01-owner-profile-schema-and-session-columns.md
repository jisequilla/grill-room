# 01 Owner profile table, session owner reference, depth columns and migration

Status: ready-for-agent
Blocked by: none
Implements: user stories 52-53
Implements decisions: `level-storage`, `profile-table-shape`, `depth-scale`, `level-scale`, `skip-defaults`, `one-idea-owner-technical-level-trait`, `existing-sessions-owner`, `migrated-sessions-under-auth-disabled`, `for-migrated-sessions-whose-readiness-ju-f836229c`

Add the storage for both values.

- In `grill-room/shared/session-constants.ts`: `TECHNICAL_LEVELS` (builder | technical-not-building | not-technical), `DEPTHS` (proof-of-concept | first-working-version | full-spec), `DEFAULT_DEPTH` = first-working-version, `DEFAULT_TECHNICAL_LEVEL` = not-technical, and `LOCAL_OWNER_ID`, the fixed id used both for the AUTH_DISABLED owner and as the migration placeholder.
- In `grill-room/server/db/schema.ts`: a new `owner_profiles` table keyed by the auth user id with a nullable `technicalLevel`; a one-row `migration_inheritance` marker holding the nullable `inheritorUserId`; on `sessions` a non-nullable `ownerId`, a `depth` column defaulting to first-working-version, and a nullable `pendingDepth`; an optional `depth` field inside the stored readiness judgment JSON. No technical-level column on sessions. Do not touch Better Auth's own tables.
- In `grill-room/server/db/migrations.ts`: create the `LOCAL_OWNER_ID` profile row and assign every existing session to it. Existing readiness judgments keep their depth field empty.
- New `grill-room/server/owner-profiles.ts`: `getOrCreateOwnerProfile(userId)`, `getTechnicalLevel(userId)` (null when unset), `setTechnicalLevel(userId, level)`.

Judged by: `grill-room/server/db/migrations.test.ts` shows existing sessions gain the placeholder owner and judgments keep no depth; unit tests cover lazy creation, null read and write; `grill-room/test/table-names.test.ts` updated; build green.