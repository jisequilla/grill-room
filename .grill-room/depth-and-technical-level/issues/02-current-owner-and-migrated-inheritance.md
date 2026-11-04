# 02 Resolve the current owner and hand local sessions and level to the inheriting user

Status: ready-for-agent
Blocked by: 01
Implements: user stories 45-51
Implements decisions: `owner-identity`, `auth-disabled-owner`, `once-login-is-on-which-signed-in-better--a9380634`, `migrated-sessions-under-auth-disabled`, `when-the-first-real-user-inherits-the-pl-0768fd04`, `if-login-is-switched-off-again-after-the-68449d29`

New `grill-room/server/current-owner.ts` with `resolveOwnerId(request)`.

- Auth on: return the signed-in Better Auth user id via `grill-room/server/middleware/auth.ts`, ensuring the profile row exists. If the `migration_inheritance` marker has no `inheritorUserId`, this user becomes the inheritor: reassign all sessions owned by `LOCAL_OWNER_ID` to them; if their profile has no level and the local profile has one, copy it; record their id on the marker; delete the local profile row. If the marker already names an inheritor and sessions owned by `LOCAL_OWNER_ID` exist (created during a later AUTH_DISABLED period), reassign them to the recorded inheritor.
- `AUTH_DISABLED` set: return `LOCAL_OWNER_ID`, creating its profile on first use. No hand-off.
- Wire `grill-room/actions/create-session.ts` to stamp `ownerId`, and `grill-room/actions/list-sessions.ts` and `grill-room/actions/get-session.ts` to scope to the current owner.

Judged by: tests for auth on and off; first sign-in inherits sessions and level once; a second user inherits nothing; local sessions created later go to the recorded inheritor; a created session carries the owner id.