# Brief 01: Owner profile table, session owner reference, depth columns and migration

You are implementing ticket 01 of "Depth and technical level before the grill". You work only inside the git worktree you were started in.

## Step 0: confirm your base

Your worktree was created from `origin/main`. Before anything else, confirm that the existing files this ticket builds on, named under File boundaries, are present. If any is missing, stop and report; do not recreate them.

The bundle is committed in this repository, so your worktree has it. Read the spec at `docs/specs/depth-and-technical-level/spec.md` and your ticket at `.grill-room/depth-and-technical-level/issues/01-owner-profile-schema-and-session-columns.md`, relative to the repository root in your worktree.

## The ticket

Blocked by: none

### 01 Owner profile table, session owner reference, depth columns and migration

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

#### Behaviour

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

## File boundaries

Files to create:

- `grill-room/server/owner-profiles.ts`
- `grill-room/server/owner-profiles.test.ts`

Files to edit:

- `grill-room/shared/session-constants.ts`
- `grill-room/server/db/schema.ts`
- `grill-room/server/db/migrations.ts`
- `grill-room/server/readiness.ts`
- `grill-room/test/table-names.test.ts`
- `grill-room/server/db/migrations.test.ts`

Existing files it builds on:

- `grill-room/server/db/schema.ts:73-76`
- `grill-room/server/db/migrations.ts:694-699`
- `grill-room/test/table-names.test.ts:143-157`
- `grill-room/server/readiness.ts:48-55`
- `grill-room/server/db/migrations.test.ts:27-40`

## Codebase facts

- The sessions table declares id, title, idea, model, answeringMode, state, readinessJson, turnStatus and the other columns, and has no owner, depth or pending-depth column today. (`grill-room/server/db/schema.ts:154-235`)
- Every app table is declared with table("gr_...", ...) as globalSettings is; the ticket's names already carry the gr_ prefix. (`grill-room/server/db/schema.ts:73-76`)
- The migrations header states that every table and index carries the gr_ prefix and that a shipped entry is never edited, only appended with a new version. (`grill-room/server/db/migrations.ts:16-35`)
- The last migration is version 83 (sessions-readiness-override), so this ticket appends version 84 onward. (`grill-room/server/db/migrations.ts:694-699`)
- The test asserts the Drizzle schema declares exactly 18 tables, so adding the two new tables requires changing that number to 20. (`grill-room/test/table-names.test.ts:143-149`)
- That test also asserts every table and index named in appMigrations starts with gr_, which would fail on an unprefixed owner_profiles table. (`grill-room/test/table-names.test.ts:151-157`)
- create-session inserts a sessions row without any owner field, and so do `server/answer-change.test.ts:117`, `server/proposal.test.ts:125` and the raw `INSERT INTO gr_sessions` rows in `server/db/migrations.test.ts`; the `local-owner` default on `owner_id` is what keeps them all working, so none of them is edited. (`grill-room/actions/create-session.ts:72-86`)
- The stored readiness judgment is a JSON text column parsed by storedReadinessSchema (ideaJudged, result, judgedAt, scoutReportId); `.nullish()` keeps the inferred `StoredReadiness` type's `depth` optional, so the `StoredReadiness` literals in `server/export.test.ts:568` and `storeReadiness` need no edit. (`grill-room/server/readiness.ts:48-55`)
- storeReadiness is what writes that JSON (ideaJudged, result, judgedAt, scoutReportId), so judgments written before this ticket carry no depth key and must parse as null. (`grill-room/server/readiness.ts:125-138`)
- Existing enumerations are exported as const arrays with a derived type in session-constants.ts, the pattern TECHNICAL_LEVELS and DEPTHS follow; schema.ts re-exports them. (`grill-room/shared/session-constants.ts:12-14`)
- A migration test stops at a version, inserts rows, then applies the rest: `appMigrations.filter((m) => m.version < N)` then `applyMigrations(before, MIGRATIONS_TABLE)` after `beforeEach(dropSchema)`, as the `projects-rename-export-folder` test does. (`grill-room/server/db/migrations.test.ts:27-40`)
- `useTestDatabase` builds the schema, seeds included, on a file's first reset and truncates every app table on later ones, so the first test in a file sees the seed rows and later tests do not. (`grill-room/test/db.ts:108-126`)
- `table-names.test.ts` checks `names.length >= appMigrations.length`, so a migration entry that only inserts or updates, naming no table, can fail it; keep seeds inside the entry that creates the table. (`grill-room/test/table-names.test.ts:151-157`)
- The project runs vitest through pnpm test (vitest --run) with default discovery of *.test.ts files and only e2e and build folders excluded, so grill-room/server/owner-profiles.test.ts is collected. (`grill-room/package.json:16`)
- The vitest config excludes only node_modules, dist, .scratch and e2e paths, leaving server/*.test.ts collected. (`grill-room/vitest.config.ts:42-52`)
- Repository rule: Each acceptance line names a test that fails with the change reverted, so the migration, lazy-creation, null-read and write cases each get a test in the new test file. (`.claude/rules/worktrees.md:28`).
- Repository rule: The builder runs pnpm test, pnpm typecheck and pnpm lint from grill-room/ before reporting. (`.claude/rules/worktrees.md:55`).

## Proved by

Test: `grill-room/server/owner-profiles.test.ts`

```bash
pnpm --dir grill-room exec vitest --run server/owner-profiles.test.ts server/db/migrations.test.ts test/table-names.test.ts
```

## Rules

- Create and edit files only within the file boundaries above. If the ticket cannot be done inside them, stop and report instead of widening them.
- Build test fixtures in the encoding production uses for the same data: when a Codebase fact states how a value is stored or sent, match it, and never encode a value twice (such as JSON.stringify into a JSON column).
- Run git only inside your worktree. Never run git against another checkout, never commit directly on `main`, and never merge anything.
- Commit on your worktree branch as you go.

## Verify

From `grill-room/` in your worktree, each must exit 0. The ticket changes no UI, so e2e is not run.

```bash
pnpm test && pnpm typecheck && pnpm lint
```

## Delivery

When verification passes, run `gh auth status`. If the active account is not the one this repository expects, do not switch it: stop after committing and report "push pending: gh account" with your commit hash.

Otherwise run `git push -u origin HEAD`, then `gh pr create --draft` against `main`, titled `<bead id>: Owner profile table, session owner reference, depth columns and migration`, with a body giving the ticket path, the files changed, the exact verification output, and anything this brief left ambiguous. Never merge, and never mark it ready — the reviewer does that once it approves.

## Report, then stop

Report:

- worktree path and branch;
- the PR URL, or "push pending: gh account" with your commit hash;
- commits and files changed;
- the exact output of the verify commands;
- anything ambiguous, and anything this brief was missing.

A separate reviewer reviews the work before any merge.

Then stop. Do no further work of any kind.
