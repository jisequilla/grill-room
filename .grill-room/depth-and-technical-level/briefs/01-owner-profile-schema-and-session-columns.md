# Brief 01: Owner profile table, session owner reference, depth columns and migration

You are implementing ticket 01 of "Depth and technical level before the grill". You work only inside the git worktree you were started in.

## Step 0: confirm your base

Your worktree was created from `origin/main`. Before anything else, confirm that the existing files this ticket builds on, named under File boundaries, are present. If any is missing, stop and report; do not recreate them.

The bundle is committed in this repository, so your worktree has it. Read the spec at `docs/specs/depth-and-technical-level/spec.md` and your ticket at `.grill-room/depth-and-technical-level/issues/01-owner-profile-schema-and-session-columns.md`, relative to the repository root in your worktree.

## The ticket

Blocked by: none

### 01 Owner profile table, session owner reference, depth columns and migration

Add the storage for both values.

- In `grill-room/shared/session-constants.ts`: `TECHNICAL_LEVELS` (builder | technical-not-building | not-technical), `DEPTHS` (proof-of-concept | first-working-version | full-spec), `DEFAULT_DEPTH` = first-working-version, `DEFAULT_TECHNICAL_LEVEL` = not-technical, and `LOCAL_OWNER_ID`, the fixed id used both for the AUTH_DISABLED owner and as the migration placeholder.
- In `grill-room/server/db/schema.ts`: a new `owner_profiles` table keyed by the auth user id with a nullable `technicalLevel`; a one-row `migration_inheritance` marker holding the nullable `inheritorUserId`; on `sessions` a non-nullable `ownerId`, a `depth` column defaulting to first-working-version, and a nullable `pendingDepth`; an optional `depth` field inside the stored readiness judgment JSON. No technical-level column on sessions. Do not touch Better Auth's own tables.
- In `grill-room/server/db/migrations.ts`: create the `LOCAL_OWNER_ID` profile row and assign every existing session to it. Existing readiness judgments keep their depth field empty.
- New `grill-room/server/owner-profiles.ts`: `getOrCreateOwnerProfile(userId)`, `getTechnicalLevel(userId)` (null when unset), `setTechnicalLevel(userId, level)`.

Judged by: `grill-room/server/db/migrations.test.ts` shows existing sessions gain the placeholder owner and judgments keep no depth; unit tests cover lazy creation, null read and write; `grill-room/test/table-names.test.ts` updated; build green.

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

Existing files it builds on:

- `grill-room/server/db/schema.ts:73-76`
- `grill-room/server/db/migrations.ts:694-699`
- `grill-room/test/table-names.test.ts:89-91`
- `grill-room/server/readiness.ts:48-55`

## Codebase facts

- The sessions table declares id, title, idea, model, answeringMode, state, readinessJson, turnStatus and the other columns, and has no owner, depth or pending-depth column today. (`grill-room/server/db/schema.ts:154-235`)
- Every app table is declared with table("gr_...", ...) as globalSettings is, so the new owner profile and inheritance marker tables must be named with the gr_ prefix (for example gr_owner_profiles), not owner_profiles as the ticket writes it. (`grill-room/server/db/schema.ts:73-76`)
- The migrations header states that every table and index carries the gr_ prefix and that a shipped entry is never edited, only appended with a new version. (`grill-room/server/db/migrations.ts:16-35`)
- The last migration is version 83 (sessions-readiness-override), so this ticket appends version 84 onward. (`grill-room/server/db/migrations.ts:694-699`)
- The test asserts the Drizzle schema declares exactly 18 tables, so adding the two new tables requires changing that number to 20. (`grill-room/test/table-names.test.ts:143-149`)
- That test also asserts every table and index named in appMigrations starts with gr_, which would fail on an unprefixed owner_profiles table. (`grill-room/test/table-names.test.ts:151-157`)
- create-session inserts a sessions row without any owner field, so a non-nullable ownerId column with no default would break this insert and every test that inserts sessions directly; the column needs a default of LOCAL_OWNER_ID in both the migration and the Drizzle declaration. (`grill-room/actions/create-session.ts:72-86`)
- The stored readiness judgment is a JSON text column parsed by storedReadinessSchema (ideaJudged, result, judgedAt, scoutReportId), so the optional depth field belongs in that zod schema in readiness.ts, defaulting to null, rather than in schema.ts. (`grill-room/server/readiness.ts:48-55`)
- storeReadiness is what writes that JSON (ideaJudged, result, judgedAt, scoutReportId), so judgments written before this ticket carry no depth key and must parse as null. (`grill-room/server/readiness.ts:125-138`)
- Existing enumerations are exported as const arrays with a derived type in session-constants.ts, the pattern TECHNICAL_LEVELS and DEPTHS follow; schema.ts re-exports them. (`grill-room/shared/session-constants.ts:12-14`)
- Migrations are applied in tests through applyMigrations(list, table) from test/db.js, which is how a migration test can stop at version 83, insert a session, then apply the new version. (`grill-room/test/table-names.test.ts:89-91`)
- The project runs vitest through pnpm test (vitest --run) with default discovery of *.test.ts files and only e2e and build folders excluded, so grill-room/server/owner-profiles.test.ts is collected. (`grill-room/package.json:16`)
- The vitest config excludes only node_modules, dist, .scratch and e2e paths, leaving server/*.test.ts collected. (`grill-room/vitest.config.ts:42-52`)
- Repository rule: Each acceptance line names a test that fails with the change reverted, so the migration, lazy-creation, null-read and write cases each get a test in the new test file. (`.claude/rules/worktrees.md:28`).
- Repository rule: The builder runs pnpm test, pnpm typecheck and pnpm lint from grill-room/ before reporting. (`.claude/rules/worktrees.md:55`).

## Proved by

Test: `grill-room/server/owner-profiles.test.ts`

```bash
pnpm --dir grill-room exec vitest --run server/owner-profiles.test.ts test/table-names.test.ts
```

## Rules

- Create and edit files only within the file boundaries above. If the ticket cannot be done inside them, stop and report instead of widening them.
- Build test fixtures in the encoding production uses for the same data: when a Codebase fact states how a value is stored or sent, match it, and never encode a value twice (such as JSON.stringify into a JSON column).
- Run git only inside your worktree. Never run git against another checkout, never commit directly on `main`, and never merge anything.
- Commit on your worktree branch as you go.

## Verify

From the repository root in your worktree, this must exit 0:

```bash
just check
```

## Delivery

When verification passes, run `gh auth status`. If the active account is not the one this repository expects, do not switch it: stop after committing and report "push pending: gh account" with your commit hash.

Otherwise run `git push -u origin HEAD`, then `gh pr create --draft` against `main`, titled `<bead id>: Owner profile table, session owner reference, depth columns and migration`, with a body giving the ticket path, the files changed, the exact verification output, and anything this brief left ambiguous. Never merge, and never mark it ready — the reviewer does that once it approves.

## Report, then stop

Report:

- worktree path and branch;
- the PR URL, or "push pending: gh account" with your commit hash;
- commits and files changed;
- the exact output of `just check`;
- anything ambiguous, and anything this brief was missing.

A separate reviewer reviews the work before any merge.

Then stop. Do no further work of any kind.
