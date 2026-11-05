# 04 Actions to read and change depth and level, with re-judge, queuing, done withdrawal and stale marking

Status: ready-for-agent
Blocked by: 01, 02, 03, 06
Implements: user stories 13-16, 29-32, 35, 37-39
Implements decisions: `mid-session-change`, `level-change-writes-back`, `depth-cadence`, `depth-change-rejudges-readiness`, `if-depth-is-changed-before-round-1-while-9d91f1eb`, `if-the-owner-has-already-chosen-grill-it-844c86c7`, `queued-depth-change-semantics`, `once-the-interviewer-has-proposed-being--05e72964`, `when-depth-changes-after-the-interviewer-456365fd`

Add `grill-room/actions/set-session-depth.ts`, `grill-room/actions/set-owner-technical-level.ts` and `grill-room/actions/get-owner-profile.ts`, modelled on `grill-room/actions/set-session-answering-mode.ts`.

`set-session-depth`:
- Before round 1, no turn working: write depth, clear the readiness override ('Grill it as is'), and re-run readiness through `assess-readiness` as ticket 03 leaves it, which judges at `session.depth` and records that depth with the judgment.
- Before round 1, a turn working: write `sessions.pendingDepth` (latest value wins). In `grill-room/server/turn.ts`, when a pre-round-1 turn finishes and `pendingDepth` is set, move it to `depth`, clear it and the override, and run one re-judge.
- After round 1: write depth; the stored judgment is untouched.
- If the interviewer has proposed done, withdraw the done proposal so the frontier reopens on the next round request. If a spec, consistency check or tickets exist, mark them stale through `grill-room/server/stale-review.ts`; never regenerate automatically.

`set-owner-technical-level` writes the profile via `setTechnicalLevel` for the current owner, `await resolveOwnerId()` from ticket 02's `grill-room/server/current-owner.ts` (no argument). `get-session` payload gains `depth`, `pendingDepth` and `technicalLevel` (live via `getTechnicalLevel(session.ownerId)`, null when unset). The next interviewer turn reads the new values through ticket 06's `InterviewContext` fields `depth` and `technicalLevel`, which the actions fill from `session.depth` and the live level.

Judged by: action tests for each depth branch, override clearing, latest-wins with a single re-judge, done proposal withdrawn with and without a spec, stale marks with no regeneration, and level write-back visible from a second session of the same owner.