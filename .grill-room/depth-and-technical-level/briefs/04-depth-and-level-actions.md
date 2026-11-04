# Brief 04: Actions to read and change depth and level, with re-judge, queuing, done withdrawal and stale marking

You are implementing ticket 04 of "Depth and technical level before the grill". You work only inside the git worktree you were started in.

## Step 0: confirm your base

Your worktree was created from `origin/main`. Before anything else, confirm that the existing files this ticket builds on, named under File boundaries, are present. If any is missing, stop and report; do not recreate them.

The bundle is committed in this repository, so your worktree has it. Read the spec at `docs/specs/depth-and-technical-level/spec.md` and your ticket at `.grill-room/depth-and-technical-level/issues/04-depth-and-level-actions.md`, relative to the repository root in your worktree.

## The ticket

Blocked by: 01, 02, 03 (merged before this brief was delegated)

### 04 Actions to read and change depth and level, with re-judge, queuing, done withdrawal and stale marking

Add `grill-room/actions/set-session-depth.ts`, `grill-room/actions/set-owner-technical-level.ts` and `grill-room/actions/get-owner-profile.ts`, modelled on `grill-room/actions/set-session-answering-mode.ts`.

`set-session-depth`:
- Before round 1, no turn working: write depth, clear the readiness override ('Grill it as is'), and re-run readiness via ticket 3's path.
- Before round 1, a turn working: write `sessions.pendingDepth` (latest value wins). In `grill-room/server/turn.ts`, when a pre-round-1 turn finishes and `pendingDepth` is set, move it to `depth`, clear it and the override, and run one re-judge.
- After round 1: write depth; the stored judgment is untouched.
- If the interviewer has proposed done, withdraw the done proposal so the frontier reopens on the next round request. If a spec, consistency check or tickets exist, mark them stale through `grill-room/server/stale-review.ts`; never regenerate automatically.

`set-owner-technical-level` writes the profile via `setTechnicalLevel` for the current owner. `get-session` payload gains `depth`, `pendingDepth` and `technicalLevel` (live, null when unset).

Judged by: action tests for each depth branch, override clearing, latest-wins with a single re-judge, done proposal withdrawn with and without a spec, stale marks with no regeneration, and level write-back visible from a second session of the same owner.

## Owner's answers on this ticket

The consistency check left these questions open; the owner has answered them. Build to these answers.

- A depth change queued behind the turn that produces round 1 is applied when that turn ends, with no re-judge: readiness runs only before round 1, and the new depth applies from the next round.
- When depth changes after a spec exists, the builder briefs and HANDOFF.md are marked stale along with the spec, its consistency check and the tickets.
- A technical-level change never withdraws a done proposal and never marks anything stale: it changes only the wording and recommendations of the next round, whatever the session's state.

## File boundaries

Files to create:

- `grill-room/actions/set-session-depth.ts`
- `grill-room/actions/set-owner-technical-level.ts`
- `grill-room/actions/get-owner-profile.ts`
- `grill-room/actions/set-session-depth.test.ts`

Files to edit:

- `grill-room/actions/get-session.ts`
- `grill-room/actions/assess-readiness.ts`
- `grill-room/server/turn.ts`

Existing files it builds on:

- `grill-room/actions/set-session-answering-mode.ts:8-26`
- `grill-room/server/session-state.ts:39-69`
- `grill-room/server/readiness.ts:293-337`
- `grill-room/actions/reopen-decision.ts:114-116`
- `grill-room/server/turn.ts:72-78`

## Codebase facts

- set-session-answering-mode is a defineAction with a zod schema of id plus an enum, an update on gr_sessions with returning(), and a thrown Error when no row, the pattern the new actions copy. (`grill-room/actions/set-session-answering-mode.ts:8-26`)
- Spec and ticket staleness is not in stale-review.ts, which handles stale decisions after a reopen; the spec is marked stale by markSpecNotCurrent in session-state.ts, and tickets are judged current against the spec's updatedAt. (`grill-room/server/session-state.ts:54-69`)
- returnSessionToInterviewing sets state to interviewing and clears doneSummary, and marks the spec not current only when the prior state was confirmed, so withdrawing a done-proposed session does not itself touch the spec. (`grill-room/server/session-state.ts:39-52`)
- reopen-decision already calls returnSessionToInterviewing for a non-interviewing session, the existing way a done proposal is withdrawn. (`grill-room/actions/reopen-decision.ts:114-116`)
- The spec row carries current, ticketsGeneratedAt and the consistency stamps (consistencyCheckedFor, consistencyAttemptedFor, consistencySpecSha256), and tickets are current only while ticketsGeneratedAt is not earlier than the spec's updatedAt. (`grill-room/server/db/schema.ts:516-558`)
- runTurn is shared by every turn kind and ends by updating the session to idle at its last statement, which is the place a pending depth is moved to depth after a pre-round-1 turn. (`grill-room/server/turn.ts:174-185`)
- The readiness logic is inline in assess-readiness's defineAction run with no exported core function, so turn.ts cannot call it without this ticket extracting one (as scout-project does with scoutProjectCore) or calling the action's run. (`grill-room/actions/assess-readiness.ts:27-153`)
- Judging again already clears the 'Grill it as is' override, because the stored update sets readinessOverrideJson to null. (`grill-room/actions/assess-readiness.ts:123-137`)
- failIfPastFirstRound refuses a judgment once a round exists (has-rounds) or while a turn is working (turn-working), and sessionHasRounds is the round-1 test. (`grill-room/server/readiness.ts:293-337`)
- get-session returns the row spread plus modelLocked and export retirement fields, so depth and pendingDepth arrive once the columns exist and technicalLevel must be added to this payload. (`grill-room/actions/get-session.ts:17-31`)
- The sessions turnStatus column holds idle, working or failed and is what 'a turn is working' reads. (`grill-room/server/db/schema.ts:225-228`)
- failIfTurnInProgress refuses with turn-in-progress when turnStatus is working. (`grill-room/server/turn.ts:72-78`)
- Repository rule: Each depth branch (before round 1 idle, before round 1 working, after round 1, done proposed, spec exists) names a test that fails with the change reverted. (`.claude/rules/worktrees.md:28`).

## Builds on

- Ticket 01: sessions.depth and sessions.pendingDepth columns — ticket 01 adds `pendingDepth` to `grill-room/server/db/schema.ts` — check: `grep -q pendingDepth grill-room/server/db/schema.ts`
- Ticket 02: resolveOwnerId for the current owner — created by ticket 02 at `grill-room/server/current-owner.ts` — check: `grep -q resolveOwnerId grill-room/server/current-owner.ts`
- Ticket 03: assess-readiness passing the session's depth and storing it with the judgment — ticket 03 adds `depth` to `grill-room/actions/assess-readiness.ts` — check: `grep -q depth grill-room/actions/assess-readiness.ts`

## Proved by

Test: `grill-room/actions/set-session-depth.test.ts`

```bash
pnpm --dir grill-room exec vitest --run actions/set-session-depth.test.ts
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

Otherwise run `git push -u origin HEAD`, then `gh pr create --draft` against `main`, titled `<bead id>: Actions to read and change depth and level, with re-judge, queuing, done withdrawal and stale marking`, with a body giving the ticket path, the files changed, the exact verification output, and anything this brief left ambiguous. Never merge, and never mark it ready — the reviewer does that once it approves.

## Report, then stop

Report:

- worktree path and branch;
- the PR URL, or "push pending: gh account" with your commit hash;
- commits and files changed;
- the exact output of `just check`;
- anything ambiguous, and anything this brief was missing.

A separate reviewer reviews the work before any merge.

Then stop. Do no further work of any kind.
