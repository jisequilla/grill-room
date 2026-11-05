# 02 Resolve the current owner and hand local sessions and level to the inheriting user

Status: ready-for-agent
Blocked by: 01
Implements: user stories 45-51
Implements decisions: `owner-identity`, `auth-disabled-owner`, `once-login-is-on-which-signed-in-better--a9380634`, `migrated-sessions-under-auth-disabled`, `when-the-first-real-user-inherits-the-pl-0768fd04`, `if-login-is-switched-off-again-after-the-68449d29`

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

## Behaviour

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
