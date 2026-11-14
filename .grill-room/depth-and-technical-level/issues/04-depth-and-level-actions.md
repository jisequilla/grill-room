# 04 Actions to read and change depth and level, with re-judge, queuing, done withdrawal and stale marking

Status: ready-for-agent
Blocked by: 01, 02, 03, 06
Implements: user stories 13-16, 29-32, 35, 37-39
Implements decisions: `mid-session-change`, `level-change-writes-back`, `depth-cadence`, `depth-change-rejudges-readiness`, `if-depth-is-changed-before-round-1-while-9d91f1eb`, `if-the-owner-has-already-chosen-grill-it-844c86c7`, `queued-depth-change-semantics`, `once-the-interviewer-has-proposed-being--05e72964`, `when-depth-changes-after-the-interviewer-456365fd`

## Intent

Depth and technical level are stored (tickets 01 and 02) and every turn already reads them (tickets 03, 06 and 07), but no action changes them. This ticket adds the three actions and the rules a change triggers: a re-judge before the interview starts, a queue behind a working turn, a done proposal withdrawn after it starts, and a spec marked not current. Every rule below is an owner decision in `docs/specs/depth-and-technical-level/decisions.md`; the owner's choices for this ticket are recorded there under the decisions this ticket implements.

Sharpening is out of scope: nothing drives a Sharpening round yet (`grill-room/server/sharpening.ts` holds only refusal functions), so decision `when-a-depth-change-during-sharpening-re-9a07c0e6` stays with bead gr-ycap.

## The rules

**Started.** A session has *started* when it has a round (`sessionHasRounds`, `grill-room/server/readiness.ts`) or its `state` is not `interviewing`. A first proposal that returned `done` leaves no round but state `done-proposed`, so that session has started.

**`set-session-depth` `{ sessionId, depth }`**, `depth` is `z.enum(DEPTHS)`. It resolves the owner with `await resolveOwnerId()` before opening the transaction (that call writes through `getDb()`), then reads the session scoped to that owner, as `get-session` does (`and(eq(id), eq(ownerId, ownerId))`); no row is a 404 (`fail(..., { statusCode: 404 })`). The check and the write run in one transaction, as `set-session-model` does, so a turn that goes idle between them cannot strand a queued value. Inside it, "has a round" is the action's own `select` on `schema.rounds` through `tx`, not `sessionHasRounds`, which reads through `getDb()`. It returns `getSession.run({ id: sessionId })` after every write, the re-judge's included. The branches, first match wins:

1. **Not started, turn working** (`turnStatus === "working"`): write `pendingDepth = depth`, or `null` when `depth` equals `session.depth`. Nothing else changes and no model turn runs.
2. **Not started, no turn working:**
   - `depth` equals `session.depth`: write only `pendingDepth = null` (a value left by a failed turn is dropped). No re-judge.
   - Otherwise: in one committed write, set `depth`, `pendingDepth = null` and `readinessOverrideJson = null`. Then, only when `readinessJson` is not null, re-judge with `assessReadiness.run({ sessionId })` (the default export of `grill-room/actions/assess-readiness.ts`), which judges at the new `session.depth` and stores it with the judgment. A re-judge that throws leaves the committed write in place and the action rethrows its error. A session with no stored judgment (never judged, or cleared by an idea edit) gets no model turn.
3. **Started, turn working:** refuse through `failIfTurnInProgress` (`grill-room/server/turn.ts`): errorCode `turn-in-progress`, 409, nothing written.
4. **Started, no turn working:**
   - `depth` equals `session.depth`: nothing is written; a done proposal stays.
   - Otherwise, in one transaction: set `depth` and `pendingDepth = null` (a queue left on a started session is dropped); when `state` is `done-proposed` or `confirmed`, call `returnSessionToInterviewing(session, now, tx)` (`grill-room/server/session-state.ts`), which sets `interviewing`, clears `doneSummary` and, leaving `confirmed`, calls `markSpecNotCurrent`. When `state` is `interviewing`, call `markSpecNotCurrent(sessionId, now, tx)` directly (it does nothing without a spec). The stored judgment (`readinessJson`) is never touched. Nothing is regenerated: no spec, tickets or consistency turn runs.

   `markSpecNotCurrent` is the whole stale mark: `ticketsAreCurrent` (`grill-room/server/tickets.ts`) and `cardsCurrent` (`grill-room/server/consistency.ts`) both read `spec.current`, so tickets and the consistency check go not current with it, while `cardsAskable` still holds. `grill-room/server/stale-review.ts` (the decision stale-review turn) is not used.

**Applying a queued depth.** Two places apply `pendingDepth`, both after their own turns succeed. A turn that throws leaves `pendingDepth` as it was; the next `set-session-depth` call, or the next successful `assess-readiness` or first-round `request-next-round`, settles it. No other action reads `pendingDepth`. `grill-room/server/turn.ts` gains no hook.

- **`assess-readiness`**, after it stores its judgment (`grill-room/actions/assess-readiness.ts`, the write with `readinessOverrideJson: null`): re-read the session; when `pendingDepth` is set and differs from `depth`, write `depth = pendingDepth` and `pendingDepth = null` (the override is already null: the judge that just stored cleared it), then judge again and return that judgment. To judge again, move the action's body into a module-level `async function judge(sessionId: string)` in the same file that `run` calls; the apply calls `judge(sessionId)` once more, which re-reads the session, judges at the new depth (a current scout report is not re-scouted) and finds no queue. Calling the action's own `run` from inside its initializer is not allowed (a type circularity). When that second judge throws, the applied depth, the cleared `pendingDepth` and the cleared override stay, and the error is rethrown: the owner's "keep on failure" choice, the same as branch 2. The queue waits only behind the turn that was working when it was set. When `pendingDepth` equals `depth`, write only `pendingDepth = null`. The judge it ran first still judged at the depth read at its start, never the pending one (ticket 03's rule). With a project, the scout turn and the judge turn are two separate `runTurn` calls, so applying only at the action's end is what keeps the scout from triggering a re-judge.
- **`request-next-round`**, after its proposal step (the `if (!isOneAtATime || pending.length === 0)` block, whether or not it ran a proposal turn) and before the `if (pending.length === 0) return` that follows it, only when the session had no round when the request began: re-read the session; when `pendingDepth` is set, apply it as branch 4 does (set `depth`; withdraw a `done-proposed` found on the re-read session, whichever turn wrote it, through `returnSessionToInterviewing`), and also write `pendingDepth = null` and `readinessOverrideJson = null`. The round-open transaction that follows uses the re-read session, not the snapshot from the start of the request. This applies whether or not a proposal turn ran (F4): the queue is settled when the first round opens. No re-judge runs: the interview has started. The "Grill it as is" record this request wrote before its turn is cleared with it, which is the owner's choice. Pending equal to `depth` writes only `pendingDepth = null`.

**`set-owner-technical-level` `{ technicalLevel }`**, `z.enum(TECHNICAL_LEVELS)` (no `null`: a level is changed, never cleared): `setTechnicalLevel(await resolveOwnerId(), technicalLevel)`, then returns `{ ownerId, technicalLevel }`. No session is written: sessions read the level live.

**`get-owner-profile` `{}`**, `http: { method: "GET" }`: returns `{ ownerId, technicalLevel: await getTechnicalLevel(ownerId) }` for `ownerId = await resolveOwnerId()`. `resolveOwnerId` already creates the profile row, so the action adds no write of its own.

**`get-session`** adds one key, `technicalLevel: await getTechnicalLevel(row.ownerId)` (null when unset). `depth` and `pendingDepth` are already in its payload through `...row`. The turn builders keep their `?? DEFAULT_TECHNICAL_LEVEL`; this ticket does not touch them.

## Behaviour

The existing test `actions/assess-readiness.test.ts` › "A3: the session's depth is used, never its pending depth" contradicts the queue rule (it expects the pending depth ignored and kept). Delete it: Q3 carries its rule, since Q3's first request must be at the stored depth.

`J(depth)` is a stored not-ready judgment made at `depth`, set through `getDb()` with `storeReadiness`. "Working" means `turnStatus` set to `"working"` through `getDb()`. Requests are counted from `interviewer.requests` by `kind`. A session without rounds is in `interviewing` unless the row says otherwise.

| ID | Setup | Call | Expected | Mutation it catches |
|---|---|---|---|---|
| D1 | No rounds; `depth` `first-working-version`; `J(first-working-version)`; an override recorded; fake scripted with one `assess-readiness` answer | `set-session-depth` `proof-of-concept` | `depth` `proof-of-concept`, `pendingDepth` null, override null; exactly 1 `assess-readiness` request, its `context.depth` `proof-of-concept`; `parseStoredReadiness(row).depth` `proof-of-concept`; the action's returned `depth` is `proof-of-concept` and its returned object has a `technicalLevel` key | no re-judge; re-judge at the old depth; returning the row read before the write |
| D2 | As D1, fake scripted with `rateLimitedTurn("assess-readiness")` | as D1 | the call rejects with the rate-limit error; `depth` `proof-of-concept`, override null, `readinessJson` equal to its value before the call | the override cleared only by `assess-readiness`'s own store; a rollback on failure |
| D3 | No rounds; `depth` `first-working-version`; `readinessJson` null | `set-session-depth` `full-spec` | `depth` `full-spec`; 0 `assess-readiness` requests | re-judging a session never judged |
| D4 | As D1 | `set-session-depth` `first-working-version` (same value) | 0 requests; `readinessJson` and the override unchanged | a re-judge or override clear on the same value |
| D5 | No rounds; `depth` `first-working-version`; `pendingDepth` `full-spec`; `turnStatus` `failed`; `readinessJson` null | `set-session-depth` `proof-of-concept` | `depth` `proof-of-concept`, `pendingDepth` null | a stale pending value left behind |
| D6 | No rounds; `depth` `first-working-version`; `pendingDepth` `full-spec`; `turnStatus` `failed`; `J(first-working-version)`; an override recorded | `set-session-depth` `first-working-version` | `pendingDepth` null; override and `readinessJson` unchanged; 0 requests | the same value re-judging or clearing the override |
| Q1 | No rounds; `depth` `first-working-version`; working | `set-session-depth` `proof-of-concept`, then `full-spec` | `depth` still `first-working-version`; `pendingDepth` `full-spec`; 0 requests | an earlier value kept over the latest; the depth written while working |
| Q2 | No rounds; `depth` `first-working-version`; `pendingDepth` `proof-of-concept`; working | `set-session-depth` `first-working-version` | `pendingDepth` null; `depth` unchanged | the latest value ignored when it equals the current depth |
| Q3 | No rounds, no project; `depth` `first-working-version`; `pendingDepth` `full-spec`; idle; override recorded; fake scripted with two `assess-readiness` answers | `assess-readiness` | exactly 2 `assess-readiness` requests, `context.depth` `first-working-version` then `full-spec`; `depth` `full-spec`, `pendingDepth` null, override null; stored judgment depth `full-spec`; the action's returned `readiness.depth` `full-spec` | no apply; apply without the re-judge; the first judge reading the pending depth; returning the first judgment |
| Q4 | As Q3 on a session with a project and no scout report; fake scripted with one scout answer and two `assess-readiness` answers | `assess-readiness` | exactly 1 scout request and 2 `assess-readiness` requests (the second at `full-spec`); stored judgment depth `full-spec` | the apply placed in `runTurn` (fires after the scout: a third judge, or the outer judge storing the old depth) |
| Q5 | As Q3, fake scripted with `rateLimitedTurn("assess-readiness")` | `assess-readiness` | rejects; `pendingDepth` still `full-spec`, `depth` still `first-working-version`, override unchanged | applying in a `finally` |
| Q6 | As Q3, fake scripted with one `assess-readiness` answer then `rateLimitedTurn("assess-readiness")` | `assess-readiness` | rejects; `depth` `full-spec`, `pendingDepth` null, override null; stored judgment depth `first-working-version` (the first judge's) | restoring the queue or the old depth when the second judge fails |
| Q7 | No rounds; `depth` `first-working-version`; `pendingDepth` `first-working-version` (set through `getDb()`); fake scripted with two `assess-readiness` answers | `assess-readiness` | exactly 1 `assess-readiness` request; `pendingDepth` null; `depth` `first-working-version` | a second judge for a queue equal to the depth |
| F1 | No rounds; `depth` `first-working-version`; `J(first-working-version)` not-ready; `pendingDepth` `proof-of-concept`; idle; fake scripted with one round | `request-next-round` | a round opens; `depth` `proof-of-concept`, `pendingDepth` null, `readinessOverrideJson` null; 0 `assess-readiness` requests | no apply after the first turn; a re-judge after round 1 |
| F2 | As F1, fake scripted with a first proposal of `done` | `request-next-round` | `depth` `proof-of-concept`, `pendingDepth` null; `state` `interviewing`, `doneSummary` null | the first-turn apply skipping the done withdrawal |
| F3 | Whole-round answering; one round, submitted; `pendingDepth` `proof-of-concept` (set through `getDb()`); fake scripted with a second round, so the proposal turn runs | `request-next-round` | `pendingDepth` still `proof-of-concept`; `depth` unchanged | the apply running on every round, not only the first |
| F4 | One-at-a-time answering; no rounds; two decisions already pending (no proposal turn needed); `depth` `first-working-version`; `pendingDepth` `proof-of-concept` | `request-next-round` | a round opens with 0 interviewer requests; `depth` `proof-of-concept`, `pendingDepth` null | the apply placed inside the proposal turn's path only |
| F5 | As F1 with `pendingDepth` `first-working-version` (equal to `depth`, set through `getDb()`) | `request-next-round` | a round opens; `pendingDepth` null; the "Grill it as is" record this request wrote is kept (`readinessOverrideJson` not null) | clearing the override for a queue equal to the depth |
| F6 | As F1, fake scripted with `rateLimitedTurn("propose-round")` | `request-next-round` | rejects; `pendingDepth` `proof-of-concept`, `depth` `first-working-version`; the override record this request wrote stays | applying in a `finally` |
| R1 | One submitted round; `depth` `first-working-version`; `J(first-working-version)` | `set-session-depth` `full-spec` | `depth` `full-spec`; `readinessJson` equal to before (`toEqual`); 0 requests | planted bug: branch 4 also writes `readinessJson = null` |
| R2 | One submitted round; `done-proposed` with a `doneSummary`; no spec | `set-session-depth` `full-spec` | `state` `interviewing`, `doneSummary` null; a following `request-next-round` (scripted with one round) opens a round | done not withdrawn |
| R3 | One submitted round; `confirmed`; a current spec with tickets and cards (`ticketsGeneratedAt` and cards after the spec's `updatedAt`) | `set-session-depth` `proof-of-concept` | `state` `interviewing`; spec `current` false and `markdown` unchanged; `ticketsAreCurrent` false; `cardsCurrent` false; `cardsAskable` true; 0 `synthesize-spec`, `break-into-tickets` and `check-consistency` requests | `confirmed` not withdrawn; planted bug: the action calls `synthesizeSpec.run` after the stale mark |
| R4 | One submitted round; `interviewing`; a spec with `current` true (set through `getDb()`) | `set-session-depth` `full-spec` | `state` `interviewing`; spec `current` false, `markdown` unchanged | no stale mark for an interviewing session; a state change |
| R5 | One submitted round; `done-proposed`; working | `set-session-depth` `full-spec` | rejects with errorCode `turn-in-progress`, 409; the row equal to before | writing while a started turn runs |
| R6 | One submitted round; `done-proposed` | `set-session-depth` with the session's own depth | `state` still `done-proposed`; `doneSummary` kept | the same value withdrawing done |
| R7 | One submitted round; `interviewing`; `pendingDepth` `proof-of-concept` (set through `getDb()`) | `set-session-depth` `full-spec` | `depth` `full-spec`, `pendingDepth` null | a stale queue left on a started session |
| O1 | Login on (`loginOn`, `as` from `server/current-owner.test.ts`); a session owned by Ana | `set-session-depth` as Ben | rejects with 404; Ana's row unchanged | the unscoped lookup `set-session-answering-mode` uses |
| L1 | Login off; two sessions of the local owner; no level set | `set-owner-technical-level` `builder` | returns `{ ownerId: LOCAL_OWNER_ID, technicalLevel: "builder" }`; `get-session` of the *other* session reports `technicalLevel` `builder`; a following `request-next-round` on it sends `context.technicalLevel` `builder` | the level written to one session; a session copy |
| L2 | Login on; Ben resolves first (so Ben inherits the local owner); then, as Ana, `set-owner-technical-level` `builder` | as Ana: the result, and `get-owner-profile`; as Ben: `get-session` of Ben's session | the result is `{ ownerId: ANA.id, technicalLevel: "builder" }`; Ana's profile `{ ownerId: ANA.id, technicalLevel: "builder" }`; Ben's `technicalLevel` null | a hard-coded `LOCAL_OWNER_ID` in either action (its level would hand off to Ben, never Ana) |
| L3 | — | `set-owner-technical-level` with `null`, and with `"expert"` | both reject before `run` executes; the level stays unset | accepting a clear |
| G1 | Login off; no level set | `get-owner-profile` | `{ ownerId: LOCAL_OWNER_ID, technicalLevel: null }` (`toEqual`) | `?? DEFAULT_TECHNICAL_LEVEL` applied, reporting `not-technical` |
| G2 | Login off; level `technical-not-building` set through `setTechnicalLevel` | `get-owner-profile` | `{ ownerId: LOCAL_OWNER_ID, technicalLevel: "technical-not-building" }` | a hard-coded null |
| S1 | A new session, no level set | `get-session` | the existing `toEqual` in `actions/get-session.test.ts` › "returns the session that was created" gains `technicalLevel: null` | the key missing |

## Pattern to copy

- An action that checks and writes in one transaction: `grill-room/actions/set-session-model.ts`.
- An owner-scoped lookup: `grill-room/actions/get-session.ts`.
- Calling another action from an action: `getCurrentRound.run` in `grill-room/actions/request-next-round.ts`.
- Done withdrawal and the stale mark: `returnSessionToInterviewing` and `markSpecNotCurrent` in `grill-room/server/session-state.ts`, as `request-next-round.ts` calls them when a round opens.
- Tests: `useTestDatabase()`, `createSession.run`, `scriptInterviewer`/`resetInterviewer`; the helpers `readinessRequests` and `sessionAt` in `grill-room/actions/assess-readiness.test.ts` and the login-on harness in `grill-room/server/current-owner.test.ts:23-110` (`loginOn`, `as`, `insertUsers`, `insertSession`, the `BETTER_AUTH_MIGRATIONS` bootstrap, and the deletes of `ownerProfiles` and `migrationInheritance` between tests) are module-private, so copy them into the new test files; done-proposed setups in `grill-room/actions/request-next-round.test.ts`; spec-with-tickets setups in `grill-room/actions/ask-consistency-findings.test.ts`.

## Acceptance

1. D1–D6, Q1, Q2, R1–R7 and O1: proved by the new `grill-room/actions/set-session-depth.test.ts`, one test per row, named by its ID.
2. Q3–Q7: proved by `grill-room/actions/assess-readiness.test.ts`, one test per row.
3. F1–F6: proved by `grill-room/actions/request-next-round.test.ts`, one test per row.
4. L1–L3: proved by the new `grill-room/actions/set-owner-technical-level.test.ts`.
5. G1 and G2: proved by the new `grill-room/actions/get-owner-profile.test.ts`.
6. S1: proved by `grill-room/actions/get-session.test.ts`. L2 sits with L1 in `set-owner-technical-level.test.ts`.
7. "Nothing is regenerated" (R3): the planted bug `synthesizeSpec.run({ sessionId })` added after the stale mark fails R3.
8. "The stored judgment is never touched after start" (R1): the planted bug of branch 4 also writing `readinessJson = null` fails R1.
9. "Only the action's end applies the queue" (Q4): the planted bug of applying the queue right after `scoutProjectCore` returns and before the judge's `runTurn` fails Q4.
10. Each row's mutation, applied alone, fails that row. Exceptions: an override-null assertion after a successful judge (D1, Q3) cannot fail alone, because `assess-readiness` clears the override when it stores; D2 carries `set-session-depth`'s own clear.

## Files

- `grill-room/actions/set-session-depth.ts` (new) and its test
- `grill-room/actions/set-owner-technical-level.ts` (new) and its test
- `grill-room/actions/get-owner-profile.ts` (new) and its test
- `grill-room/actions/get-session.ts` and `grill-room/actions/get-session.test.ts`
- `grill-room/actions/assess-readiness.ts` and `grill-room/actions/assess-readiness.test.ts`
- `grill-room/actions/request-next-round.ts` and `grill-room/actions/request-next-round.test.ts`
- `grill-room/AGENTS.md`: one row each for the three new actions in its action table, beside `set-session-answering-mode`

## Builds on

Confirm each exists before starting; stop and report if one does not.

- `sessions.depth`, `sessions.pendingDepth`, `sessions.readinessJson`, `sessions.readinessOverrideJson`, `sessions.turnStatus`, `sessions.doneSummary` in `grill-room/server/db/schema.ts`
- `DEPTHS`, `Depth`, `TECHNICAL_LEVELS`, `LOCAL_OWNER_ID` in `grill-room/shared/session-constants.ts`
- `resolveOwnerId` in `grill-room/server/current-owner.ts`
- `getTechnicalLevel`, `setTechnicalLevel` in `grill-room/server/owner-profiles.ts`
- `sessionHasRounds`, `storeReadiness`, `parseStoredReadiness` in `grill-room/server/readiness.ts`
- `failIfTurnInProgress` in `grill-room/server/turn.ts`
- `returnSessionToInterviewing`, `markSpecNotCurrent` in `grill-room/server/session-state.ts`
- `ticketsAreCurrent` in `grill-room/server/tickets.ts`; `cardsCurrent`, `cardsAskable` in `grill-room/server/consistency.ts`
- `rateLimitedTurn` in `grill-room/server/interviewer/fake.ts`; `scriptInterviewer`, `resetInterviewer` in `grill-room/server/interviewer/index.ts`

## Verify

From `grill-room/`: `pnpm test`, `pnpm typecheck` and `pnpm lint`, each exit 0 with no findings. No UI changes, so no `just e2e`.

## Open questions

None.
