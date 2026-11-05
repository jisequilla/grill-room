# Brief 02: Resolve the current owner and hand local sessions and level to the inheriting user

You are implementing ticket 02 of "Depth and technical level before the grill". You work only inside the git worktree you were started in.

## Step 0: confirm your base

Your worktree was created from `origin/main`. Before anything else, confirm that the existing files this ticket builds on, named under File boundaries and Builds on, are present. If any is missing, stop and report; do not recreate them.

The bundle is committed in this repository, so your worktree has it. Read the spec at `docs/specs/depth-and-technical-level/spec.md` and your ticket at `.grill-room/depth-and-technical-level/issues/02-current-owner-and-migrated-inheritance.md`, relative to the repository root in your worktree.

## The ticket

Blocked by: 01 (merged before this brief was delegated)

### 02 Resolve the current owner and hand local sessions and level to the inheriting user

Decide who the current owner is, hand everything stamped `local-owner` to the user who inherits it, and scope three session actions to the current owner. Every name below is exact.

- **Module.** New `grill-room/server/current-owner.ts` exports:
  - `isAuthDisabled(): boolean`: true only when `process.env.AUTH_DISABLED`, trimmed and lower-cased, is `1` or `true`. This is the framework's own rule (`isAuthDisabled` in `@agent-native/core`'s `dist/server/auth.js`), which the package does not export, so it is replicated here exactly.
  - `class OwnerNotResolvedError extends Error`, with `name` `"OwnerNotResolvedError"`.
  - `resolveOwnerId(): Promise<string>`. It takes no argument: actions receive no request or h3 event, so the identity comes from the framework's request context.
- **Login off** (`isAuthDisabled()` true): return `LOCAL_OWNER_ID`, after `getOrCreateOwnerProfile(LOCAL_OWNER_ID)`. This holds even when the request carries a signed-in email (a user who opted out through the framework's cookie). No hand-off runs.
- **Login on:**
  1. The email is `getRequestUserEmail()` from `@agent-native/core/server/request-context`. No email (undefined, or empty after trimming): throw `OwnerNotResolvedError`. The lookup uses the trimmed email.
  2. The owner id is the Better Auth user id, read from the framework's `"user"` table with `getDbExec().execute({ sql: 'SELECT id FROM "user" WHERE LOWER(email) = LOWER(?) LIMIT 1', args: [email] })` (the framework's own query style). No row: throw `OwnerNotResolvedError`. Better Auth's tables are only read, never written.
  3. `getOrCreateOwnerProfile(userId)`.
  4. Claim the inheritance, all inside `claimInheritance`: insert the marker row (`id` `singleton`, null inheritor) if it is missing, doing nothing on conflict; then one conditional update, `SET inheritor_user_id = userId WHERE id = 'singleton' AND inheritor_user_id IS NULL`, in an exported `claimInheritance(userId): Promise<boolean>` that returns true only when its update changed a row. Exactly one of two concurrent first resolves wins it; the loser inherits nothing. The first user to resolve while the inheritor is null wins, even with nothing to move.
  5. Hand-off, on every login-on resolve, by any user, to the inheritor the marker now names (the resolving user or someone earlier):
     - every session whose `owner_id` is `local-owner` moves to the inheritor;
     - if a `local-owner` profile row exists: its level moves to the inheritor only when the inheritor's level is null and the local level is not, written with `setTechnicalLevel` so an inheritor with no profile row gets one, and then the `local-owner` row is deleted.

     With nothing stamped `local-owner`, it changes nothing, so a second resolve is a no-op.
  6. Return `userId`.
- **Actions.**
  - `grill-room/actions/create-session.ts` stamps `ownerId: await resolveOwnerId()` on the inserted row.
  - `grill-room/actions/list-sessions.ts` returns only the current owner's sessions.
  - `grill-room/actions/get-session.ts` reads the session by id and owner. Another owner's id fails with the existing `Session not found: <id>` error: no 403, nothing leaked.
  - With no resolvable owner, all three reject with `OwnerNotResolvedError`.
- **Test setup.** `grill-room/test/setup.ts` sets `process.env.AUTH_DISABLED = "true"` and deletes `process.env.AGENT_USER_EMAIL` for the whole suite, so every existing test that calls `run(...)` with no identity runs as `local-owner`, which is the column default its rows already carry. A test that needs login on stubs `AUTH_DISABLED` (and `AGENT_USER_EMAIL`, which `getRequestUserEmail()` falls back to outside a request context) and restores both afterwards.

Out of scope: every other action that takes a session id stays unscoped in this ticket.

#### Behaviour

`ana` and `ben` are rows in Better Auth's `"user"` table, with ids `u-ana` and `u-ben` and emails `ana@example.test` and `ben@example.test`. "As ana" means inside `runWithRequestContext({ userEmail: "ana@example.test" }, ...)`. "Login on" means `AUTH_DISABLED` is stubbed to `""` and `AGENT_USER_EMAIL` to `""`. Every row starts from the marker row (`singleton`, null) unless it says otherwise. The test harness truncates every table, `"user"` included, between tests, so each test inserts ana and ben itself; no test calls `rebuildTestSchema`.

| # | Input | Expected | Mutation it catches |
|---|---|---|---|
| R1 | `AUTH_DISABLED` `true`, no request context; no `local-owner` profile row | `resolveOwnerId()` is `local-owner`; a `local-owner` profile row now exists; the marker's inheritor is still null | a login-off path that runs the hand-off or claims the marker; one that does not create the local profile |
| R1c | `AUTH_DISABLED` `true`, no request context; marker inheritor `u-ana`; 2 sessions owned by `local-owner`; a `local-owner` profile with level `builder` | `local-owner`; both sessions are still owned by `local-owner`; the `local-owner` profile row and its level `builder` are still there; the marker is unchanged | a hand-off that runs with login off |
| R1b | `AUTH_DISABLED` `" TRUE "`, as ana | `local-owner`; the marker's inheritor is still null | a check that is case- or whitespace-sensitive; one that prefers a signed-in email over login off |
| R2 | Login on; 3 sessions owned by `local-owner`; `local-owner` profile with level `builder`; ana has no profile; as ana, resolve | (a) all 3 sessions have `owner_id` `u-ana`; (b) `getTechnicalLevel("u-ana")` is `builder`; (c) the marker's inheritor is `u-ana`; (d) no `local-owner` profile row exists | a hand-off that skips sessions, level, marker or row deletion (each assertion catches one) |
| R3 | As R2, but ana's profile already has level `not-technical` | `getTechnicalLevel("u-ana")` is `not-technical`; no `local-owner` profile row exists; the sessions moved to `u-ana` | a level copy that overwrites a set level |
| R4 | Marker inheritor `u-ana`; ben has no profile; no `local-owner` sessions; as ben, resolve | returns `u-ben`; the marker's inheritor is still `u-ana`; ben owns 0 sessions; a `u-ben` profile row exists | a claim that is not conditional on a null inheritor |
| R5 | Marker inheritor `u-ana`, ana's level null; 2 sessions owned by `local-owner` (created later with login off); a recreated `local-owner` profile with level `technical-not-building`; as ben, resolve | returns `u-ben`; both sessions are owned by `u-ana`; `getTechnicalLevel("u-ana")` is `technical-not-building`; no `local-owner` profile row; ben owns 0 sessions | a later hand-off that runs only for the inheritor's own resolve, or that gives the sessions to the resolving user |
| R5b | As R5, but ana has no `gr_owner_profiles` row | `getTechnicalLevel("u-ana")` is `technical-not-building`; no `local-owner` profile row | a level move that only updates an existing row |
| R6 | After R2, as ana, resolve a second time | the session `owner_id`s, `getTechnicalLevel("u-ana")` and the marker are unchanged from after the first resolve; still no `local-owner` profile row | a resolve that is not idempotent (for example one that recreates the local row, or that clears the level) |
| R7 | Login on, as ana (marker inheritor already `u-ana`), `create-session` | the returned row's `ownerId` is `u-ana`, and so is the stored row's | a create that keeps the column default |
| R8 | Login on; session A owned by `u-ana` and session B owned by `u-ben`, both inserted directly; as ana | `list-sessions` returns exactly [A]; `get-session` of A returns it; `get-session` of B rejects with `Session not found: <B's id>` | an unscoped list; a get that checks only the id; a get that throws a different error for another owner's id |
| R9 | Login on; (a) no request context; (b) as `nobody@example.test`, which has no `"user"` row | `resolveOwnerId()` rejects with `OwnerNotResolvedError` in both; `list-sessions`, `get-session` and `create-session` each reject with it in case (a), and `create-session` stores no row | a fallback to `local-owner` when login is on |
| R10 | Marker inheritor null; `Promise.all` of `claimInheritance("u-ana")` and `claimInheritance("u-ben")` | exactly one call returns true; the marker names that user | a claim that selects the inheritor and, when it is null, runs an unconditional `UPDATE ... SET inheritor_user_id = userId`: PGlite runs both selects before either update, so both calls return true |
| R12 | Login on; no marker row at all; no `local-owner` rows; as ana, resolve | returns `u-ana`; a marker row `singleton` exists and names `u-ana` | a claim that does not insert the missing marker row |
| R13 | Login on; as ana with email `" ana@example.test "` | returns `u-ana` | a lookup that uses the untrimmed email |
| R11 | `AUTH_DISABLED` `false`, no request context | `resolveOwnerId()` rejects with `OwnerNotResolvedError` | treating any set value as login off |

Judged by:
- every row in `grill-room/server/current-owner.test.ts`; R7, R8 and R9 call the actions' `run` there, not `resolveOwnerId` alone;
- the existing suites for `create-session`, `list-sessions` and `get-session` still pass unedited, under `AUTH_DISABLED` `true` from `grill-room/test/setup.ts`;
- `pnpm test`, `pnpm typecheck` and `pnpm lint` green.

## Owner's answers on this ticket

The consistency check left these questions open; the owner has answered them. Build to these answers.

- When local sessions created after the hand-off are reassigned to the recorded inheritor, a technical level set on the recreated `local-owner` profile moves to the inheritor only when the inheritor's level is empty, and the `local-owner` profile row is deleted again.

## File boundaries

Files to create:

- `grill-room/server/current-owner.ts`
- `grill-room/server/current-owner.test.ts`

Files to edit:

- `grill-room/actions/create-session.ts`
- `grill-room/actions/list-sessions.ts`
- `grill-room/actions/get-session.ts`
- `grill-room/test/setup.ts`

Existing files it builds on:

- `grill-room/server/owner-profiles.ts:21-73`
- `grill-room/server/db/schema.ts:93-109`
- `grill-room/server/db/schema.ts:195-199`
- `grill-room/shared/session-constants.ts:186-191`
- `grill-room/test/db.ts:83-92`
- `grill-room/test/setup.ts:16-21`

## Codebase facts

- Actions receive only their parsed arguments in `run`, with no request or event, so `resolveOwnerId` takes no argument. (`grill-room/actions/set-session-answering-mode.ts:8-26`)
- The request identity is `getRequestUserEmail()`. Inside a request context it returns that context's `userEmail`, even when that is undefined. With no request context it falls back to `process.env.AGENT_USER_EMAIL`, so a login-on test stubs that variable empty. (`grill-room/node_modules/@agent-native/core/dist/server/request-context.d.ts:284-297`)
- Framework actions mounted at `/_agent-native/actions/...` always run inside `runWithRequestContext`, so an HTTP call to these actions carries the signed-in email. (`grill-room/node_modules/@agent-native/core/dist/server/request-context.d.ts:340-347`)
- `runWithRequestContext(ctx, fn)` is how a test runs an action as a given email. (`grill-room/node_modules/@agent-native/core/dist/server/request-context.d.ts:247`)
- The framework's login-off rule is `AUTH_DISABLED` trimmed and lower-cased equal to `1` or `true`, in an unexported `isAuthDisabled()`. With it on, a request without the opt-out cookie runs as `dev@local.test`, so the email alone cannot say login is off. (`grill-room/node_modules/@agent-native/core/dist/server/auth.js:3037-3051`)
- Better Auth's user table is `"user"` (`id TEXT PRIMARY KEY`, `email TEXT NOT NULL UNIQUE`, `name`, `email_verified`, `created_at`, `updated_at`), created by `BETTER_AUTH_MIGRATIONS`, which `@agent-native/core/server` exports. (`grill-room/node_modules/@agent-native/core/dist/server/better-auth-migrations.js:40-54`)
- The framework reads that table with `getDbExec().execute({ sql, args })`, using `?` placeholders and a quoted `"user"`. (`grill-room/node_modules/@agent-native/core/dist/server/auth.js:1388-1393`)
- The test harness creates the app's tables only, so `current-owner.test.ts` applies `BETTER_AUTH_MIGRATIONS` itself with `applyMigrations(BETTER_AUTH_MIGRATIONS, "_better_auth_migrations")`, as `table-names.test.ts` does. Do it once per file, after the harness's first reset, behind a module-level flag. Later resets truncate every public table except the app's migration bookkeeping, so the `"user"` table survives and its rows do not. (`grill-room/test/db.ts:31-35`, `grill-room/test/db.ts:115-127`, `grill-room/test/table-names.test.ts:88-90`)
- After the first reset in a file, the seed rows (`local-owner` profile, `singleton` marker) are gone, so each test arranges what it needs; `resolveOwnerId` inserting a missing marker row is what makes a truncated database still claimable. (`grill-room/server/db/migrations.ts:700-724`)
- `getOrCreateOwnerProfile`, `getTechnicalLevel` and `setTechnicalLevel` are the only readers and writers of `gr_owner_profiles` so far; deleting the `local-owner` row has no helper, so `current-owner.ts` deletes it with `getDb()` directly. (`grill-room/server/owner-profiles.ts:21-73`)
- `migrationInheritance` (`id`, `inheritorUserId`) and `sessions.ownerId` (not null, default `local-owner`, no foreign key) are the Drizzle names. (`grill-room/server/db/schema.ts:106-109`, `grill-room/server/db/schema.ts:195-199`)
- `and`, `eq` and `isNull` come from `@agent-native/core/db/schema`. (`grill-room/node_modules/@agent-native/core/dist/db/schema.d.ts:6`)
- A multi-write step runs in `getDb().transaction(...)`, as `server/answer-change.ts` does. (`grill-room/server/answer-change.ts:132`)
- `list-sessions` selects every session with no where clause. (`grill-room/actions/list-sessions.ts:15-22`)
- `get-session` reads by id alone and throws `Session not found: ${id}`, and its test asserts that message. (`grill-room/actions/get-session.ts:17-23`, `grill-room/actions/get-session.test.ts:34-38`)
- `create-session` inserts the row without an owner today. (`grill-room/actions/create-session.ts:72-86`)
- The vitest setup file is `test/setup.ts`, run before every test file; it already pins environment variables there. (`grill-room/vitest.config.ts:35`, `grill-room/test/setup.ts:16-21`)
- The Playwright server runs with `AUTH_DISABLED` `"true"`, so e2e runs as `local-owner`. (`grill-room/playwright.config.ts:35`)
- Repository rule: each acceptance line names a test that fails with the change reverted. (`.claude/rules/worktrees.md:28`)

## Builds on

- Ticket 01: `getOrCreateOwnerProfile`, `getTechnicalLevel` and `setTechnicalLevel` in `grill-room/server/owner-profiles.ts`, `LOCAL_OWNER_ID` in `grill-room/shared/session-constants.ts`, the `migrationInheritance` table and `sessions.ownerId` in `grill-room/server/db/schema.ts`. Merged in PR #277. Check: `grep -q getOrCreateOwnerProfile grill-room/server/owner-profiles.ts && grep -q migrationInheritance grill-room/server/db/schema.ts`

## Proved by

Test: `grill-room/server/current-owner.test.ts`

```bash
pnpm --dir grill-room exec vitest --run server/current-owner.test.ts actions/create-session.test.ts actions/list-sessions.test.ts actions/get-session.test.ts
```

## Rules

- Create and edit files only within the file boundaries above. If the ticket cannot be done inside them, stop and report instead of widening them.
- Build test fixtures in the encoding production uses for the same data: when a Codebase fact states how a value is stored or sent, match it, and never encode a value twice (such as JSON.stringify into a JSON column).
- Prove each Behaviour row by reverting the change it covers (or applying the mutation it names), watching its test fail, and restoring it.
- If setting `AUTH_DISABLED` in `test/setup.ts` changes the outcome of any existing test, stop and report rather than editing that test.
- Run git only inside your worktree. Never run git against another checkout, never commit directly on `main`, and never merge anything.
- Commit on your worktree branch as you go.

## Verify

From `grill-room/` in your worktree, each must exit 0. The ticket changes no UI, so e2e is not run.

```bash
pnpm test && pnpm typecheck && pnpm lint
```

## Delivery

When verification passes, run `gh auth status`. If the active account is not the one this repository expects, do not switch it: stop after committing and report "push pending: gh account" with your commit hash.

Otherwise run `git push -u origin HEAD`, then `gh pr create --draft` against `main`, titled `<bead id>: Resolve the current owner and hand local sessions and level to the inheriting user`, with a body giving the ticket path, the files changed, the exact verification output, and anything this brief left ambiguous. Never merge, and never mark it ready — the reviewer does that once it approves.

## Report, then stop

Report:

- worktree path and branch;
- the PR URL, or "push pending: gh account" with your commit hash;
- commits and files changed;
- the exact output of the verify commands;
- anything ambiguous, and anything this brief was missing.

A separate reviewer reviews the work before any merge.

Then stop. Do no further work of any kind.
