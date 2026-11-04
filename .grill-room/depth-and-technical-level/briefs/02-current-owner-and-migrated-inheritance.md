# Brief 02: Resolve the current owner and hand local sessions and level to the inheriting user

You are implementing ticket 02 of "Depth and technical level before the grill". You work only inside the git worktree you were started in.

## Step 0: confirm your base

Your worktree was created from `origin/main`. Before anything else, confirm that the existing files this ticket builds on, named under File boundaries, are present. If any is missing, stop and report; do not recreate them.

The bundle is committed in this repository, so your worktree has it. Read the spec at `docs/specs/depth-and-technical-level/spec.md` and your ticket at `.grill-room/depth-and-technical-level/issues/02-current-owner-and-migrated-inheritance.md`, relative to the repository root in your worktree.

## The ticket

Blocked by: 01 (merged before this brief was delegated)

### 02 Resolve the current owner and hand local sessions and level to the inheriting user

New `grill-room/server/current-owner.ts` with `resolveOwnerId(request)`.

- Auth on: return the signed-in Better Auth user id via `grill-room/server/middleware/auth.ts`, ensuring the profile row exists. If the `migration_inheritance` marker has no `inheritorUserId`, this user becomes the inheritor: reassign all sessions owned by `LOCAL_OWNER_ID` to them; if their profile has no level and the local profile has one, copy it; record their id on the marker; delete the local profile row. If the marker already names an inheritor and sessions owned by `LOCAL_OWNER_ID` exist (created during a later AUTH_DISABLED period), reassign them to the recorded inheritor.
- `AUTH_DISABLED` set: return `LOCAL_OWNER_ID`, creating its profile on first use. No hand-off.
- Wire `grill-room/actions/create-session.ts` to stamp `ownerId`, and `grill-room/actions/list-sessions.ts` and `grill-room/actions/get-session.ts` to scope to the current owner.

Judged by: tests for auth on and off; first sign-in inherits sessions and level once; a second user inherits nothing; local sessions created later go to the recorded inheritor; a created session carries the owner id.

## Open questions on this ticket

The consistency check found that this ticket leaves these questions to the owner. Do not choose an answer yourself: if your prompt does not give you the owner's answer to one, stop and report the question instead of building around it.

- When later local sessions are reassigned to the recorded inheritor, does a technical level set on the recreated local profile also move to the inheritor if theirs is empty, and is the local profile row deleted again? ("reassign them to the recorded inheritor.")

## File boundaries

Files to create:

- `grill-room/server/current-owner.ts`
- `grill-room/server/current-owner.test.ts`

Files to edit:

- `grill-room/actions/create-session.ts`
- `grill-room/actions/list-sessions.ts`
- `grill-room/actions/get-session.ts`

Existing files it builds on:

- `grill-room/server/middleware/auth.ts:13-15`
- `grill-room/actions/set-session-answering-mode.ts:8-26`

## Codebase facts

- The auth middleware only returns runAuthGuard(event) and exposes no user id, so resolveOwnerId cannot get the signed-in id 'via middleware/auth.ts' as the ticket says. (`grill-room/server/middleware/auth.ts:13-15`)
- Actions in this app receive only their parsed arguments in run, with no request or event parameter, so resolveOwnerId(request) has no request to take and must read the framework's request context instead. (`grill-room/actions/set-session-answering-mode.ts:8-26`)
- The framework documentation shows the request identity as getRequestUserEmail() from @agent-native/core/server/request-context, which returns an email and warns against falling back to a sentinel; no tracked app code calls it, so this ticket must confirm what stable user id the framework exposes before keying profiles on it. (`grill-room/.agents/skills/sharing/SKILL.md:167-181`)
- AUTH_DISABLED is documented as skipping login and signup for local dev, and the Playwright config sets it to true, so e2e runs execute under the fixed local owner. (`grill-room/DEVELOPING.md:321`)
- The Playwright web server environment sets AUTH_DISABLED to "true". (`grill-room/playwright.config.ts:35`)
- list-sessions selects every row of gr_sessions with no where clause, so scoping to the current owner adds a filter to this query. (`grill-room/actions/list-sessions.ts:15-22`)
- get-session reads one session by id with no owner check and returns the row spread plus modelLocked and export retirement fields. (`grill-room/actions/get-session.ts:17-31`)
- create-session inserts the session row and returns it; it must add ownerId from resolveOwnerId to this values object. (`grill-room/actions/create-session.ts:72-88`)
- Ticket 1's new columns are not in the code yet: sessions has no ownerId today, so the ownerId stamp depends on ticket 1's schema edit. (`grill-room/server/db/schema.ts:154-235`)
- Repository rule: Each acceptance line (auth on, auth off, first sign-in inheritance, second user inherits nothing, later local sessions reassigned) names a test that fails with the change reverted. (`.claude/rules/worktrees.md:28`).

## Builds on

- Ticket 01: getOrCreateOwnerProfile and getTechnicalLevel/setTechnicalLevel in server/owner-profiles.ts, LOCAL_OWNER_ID, the migration_inheritance marker table and sessions.ownerId — created by ticket 01 at `grill-room/server/owner-profiles.ts` — check: `grep -q getOrCreateOwnerProfile grill-room/server/owner-profiles.ts`

## Proved by

Test: `grill-room/server/current-owner.test.ts`

```bash
pnpm --dir grill-room exec vitest --run server/current-owner.test.ts
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

Otherwise run `git push -u origin HEAD`, then `gh pr create --draft` against `main`, titled `<bead id>: Resolve the current owner and hand local sessions and level to the inheriting user`, with a body giving the ticket path, the files changed, the exact verification output, and anything this brief left ambiguous. Never merge, and never mark it ready — the reviewer does that once it approves.

## Report, then stop

Report:

- worktree path and branch;
- the PR URL, or "push pending: gh account" with your commit hash;
- commits and files changed;
- the exact output of `just check`;
- anything ambiguous, and anything this brief was missing.

A separate reviewer reviews the work before any merge.

Then stop. Do no further work of any kind.
