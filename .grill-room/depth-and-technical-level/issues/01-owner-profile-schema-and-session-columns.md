# 01 Owner profile table, session owner reference, depth columns and migration

Status: ready-for-agent
Blocked by: none
Implements: user stories 52-53
Implements decisions: `level-storage`, `profile-table-shape`, `depth-scale`, `level-scale`, `skip-defaults`, `one-idea-owner-technical-level-trait`, `existing-sessions-owner`, `migrated-sessions-under-auth-disabled`, `for-migrated-sessions-whose-readiness-ju-f836229c`

Add the storage for both values. Every name below is exact.

- **Constants**, in `grill-room/shared/session-constants.ts`, following the const-array-plus-derived-type pattern already there:
  - `TECHNICAL_LEVELS` = `builder`, `technical-not-building`, `not-technical`, with type `TechnicalLevel`;
  - `DEPTHS` = `proof-of-concept`, `first-working-version`, `full-spec`, with type `Depth`;
  - `DEFAULT_DEPTH` = `first-working-version`;
  - `DEFAULT_TECHNICAL_LEVEL` = `not-technical`;
  - `LOCAL_OWNER_ID` = `local-owner`, the one id for the AUTH_DISABLED owner and for the migration placeholder.

  `grill-room/server/db/schema.ts` re-exports all five, and both types, as it re-exports the existing constants.
- **Tables**, in `grill-room/server/db/schema.ts`. Better Auth's own tables are not touched.

  | Table | Drizzle export | Columns |
  |---|---|---|
  | `gr_owner_profiles` | `ownerProfiles` | `user_id` text primary key; `technical_level` text, nullable; `created_at` and `updated_at` as the other tables carry them |
  | `gr_migration_inheritance` | `migrationInheritance` | `id` text primary key, always `singleton`; `inheritor_user_id` text, nullable |
  | `gr_sessions` (added columns) | `ownerId`, `depth`, `pendingDepth` | `owner_id` text, not null, default `local-owner`, with no foreign key; `depth` text, not null, default `first-working-version`; `pending_depth` text, nullable |

  Sessions get no technical-level column.
- **Readiness judgment.** `storedReadinessSchema` in `grill-room/server/readiness.ts` gains `depth: z.enum(DEPTHS).nullish()`. Absent and null both parse, so `StoredReadiness` literals without `depth` still typecheck. The signature of `storeReadiness` does not change. `parseStoredReadiness` may be exported for the migration test.
- **Migration**, appended to `grill-room/server/db/migrations.ts` from version 84. Shipped entries are never edited.
  - Each new entry creates or alters a `gr_` table, so the check that every migration names a table still holds.
  - A seed `INSERT` goes in the same entry as the `CREATE` of its table, and gives `created_at` and `updated_at` a literal ISO-8601 string, so the SQL stays portable between PGlite and the production database.
  - Every database is seeded, fresh installs included. The seeds are the `local-owner` profile row, with a null level, and the marker row `singleton`, with a null inheritor.
  - Existing sessions get `owner_id` = `local-owner`, and their `readiness_json` is left unchanged.
- **Module.** New `grill-room/server/owner-profiles.ts`:
  - `getOrCreateOwnerProfile(userId)` returns `{ userId, technicalLevel }` and inserts a row with a null level when none exists;
  - `getTechnicalLevel(userId)` returns the level, or null, and creates no row;
  - `setTechnicalLevel(userId, level: TechnicalLevel | null)` upserts the level, and refuses a value outside `TECHNICAL_LEVELS` with an error.

Out of scope, for ticket 02: stamping the signed-in owner on new sessions, and removing the `local-owner` row at first sign-in.

## Behaviour

| # | Input | Expected | Mutation it catches |
|---|---|---|---|
| 1 | Database migrated to version 83, holding session S whose `readiness_json` R is a valid stored judgment with no depth key and an `ideaJudged` equal to S's idea; apply the rest | S has `owner_id` `local-owner`, `depth` `first-working-version`, `pending_depth` null; `readiness_json` is byte-identical to R (this comparison is the catch); `parseStoredReadiness({ idea, readinessJson })` is non-null with `depth` null or undefined | an `owner_id` default other than `local-owner`; a migration that rewrites or stamps `readiness_json` |
| 2 | Empty database, all migrations applied | `gr_owner_profiles` has exactly one row, (`local-owner`, null level); `gr_migration_inheritance` has exactly one row, (`singleton`, null) | a missing seed; a seed that runs only when sessions exist |
| 3 | After all migrations, insert a session naming no owner and no depth | `owner_id` is `local-owner`; `depth` is `first-working-version` | a missing column default |
| 4 | Columns of `gr_sessions` after all migrations | none contains `technical` or `level` | a planted `technical_level` column |
| 4b | Foreign keys on `gr_sessions` after all migrations | none on `owner_id` | a planted `REFERENCES` on `owner_id` |
| 5 | `getTechnicalLevel("u1")`, no row | null, and `gr_owner_profiles` still has no `u1` row | a read that creates a row |
| 6 | `getOrCreateOwnerProfile("u1")` called twice | one `u1` row; both calls return `{ userId: "u1", technicalLevel: null }` | a duplicate insert, or a throw on the second call |
| 7 | `setTechnicalLevel("u1", "builder")`, no row | a row is created; `getTechnicalLevel("u1")` is `builder` | a set that only updates an existing row |
| 8 | In one test: `setTechnicalLevel("u1", "builder")`, then `setTechnicalLevel("u1", null)` | `getTechnicalLevel("u1")` is null | a set that ignores null |
| 9 | In one test: `setTechnicalLevel("u1", "builder")`, then `setTechnicalLevel("u1", "expert" as never)`; separately, `setTechnicalLevel("u2", "expert" as never)` with no `u2` row | the first throws and `getTechnicalLevel("u1")` is still `builder`; the second throws and no `u2` row exists | a set with no runtime check; a set that inserts before validating |

Judged by:
- rows 1–4b in `grill-room/server/db/migrations.test.ts`, copying the stop-at-a-version pattern of the `projects-rename-export-folder` test there;
- rows 5–9 in `grill-room/server/owner-profiles.test.ts`, each asserting only on its own user ids, never on the total row count (the first test in a file sees the seed rows, later ones do not);
- the table count in `grill-room/test/table-names.test.ts`, raised from 18 to 20;
- `pnpm test`, `pnpm typecheck` and `pnpm lint` green.
