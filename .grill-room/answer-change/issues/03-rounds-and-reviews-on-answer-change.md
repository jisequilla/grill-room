# 03 Move round submission, next-round and stale review onto Answer change

Status: ready-for-agent
Blocked by: 01
Suggested model: opus

## What to build

Move the multi-change callers onto Answer change, which ticket 01 builds. Each caller makes all of its changes in one transaction, passing its handle to every transition. See the spec's Implementation Decisions.

- **submit-round.** Settle each placed decision with its draft answer and kind, all in one transaction. Settle sets settledAt only when the kind settles, as today. A decision that had an answer now gets a history row. Add the turn-in-progress check. Its call to request the next round stays after the transaction commits.
- **request-next-round, returning deferrals.** Each deferred decision returning in a round is unsettled. Its reopenedAt stays unchanged, because a deferral is not settled. Returning the session to interviewing and creating the round stay in the action, in the same transaction.
- **request-next-round, push-backs.** Each pushed-back decision is withdrawn, with the interviewer's explanation as the reason.
- **Stale review, re-ask.** Unsettle the decision. The caller's rewrite of the question (title, body, choices) goes in the same transaction. Delete the hand-rolled claim withdrawal. Reconfirm stays a plain re-stamp of settledAt, outside Answer change.

Every existing refusal code stays unchanged.

## Behaviour

| Start state | Call | Expected |
|---|---|---|
| round placing decision D, which already had answer "A" | submit-round | D's history has a row with A; claims naming D withdrawn |
| round placing a first-time answer | submit-round | no history row |
| round with draft kind `unknown` | submit-round | settledAt null |
| a turn is running | submit-round | 409 `turn-in-progress`; nothing written |
| deferred decision returning in a new round | request-next-round | answer and kind cleared; reopenedAt unchanged; one history row |
| interviewer pushes back on settled decision P, while another decision has a pending supersession by P | request-next-round | P withdrawn with the explanation as reason; P's own proposals and links cleared; the supersession naming P cleared |
| stale decision S re-asked, while decision Z is replaced by S | stale review | S unsettled, with reopenedAt now and the question rewritten; Z's replaced-by cleared |
| stale decision reconfirmed | stale review | only settledAt re-stamped; no history row; no claims withdrawn |
| a failure inside submit-round after its first settle | submit-round | no decision in the round changed |

## Pattern to copy

The reopen migration in ticket 01: the caller's own writes and the transition share one transaction.

## Acceptance

1. Each row of the behaviour table has its own test, in the action's or stale review's test file.
2. The atomicity row is proved by forcing a failure in the middle of the transaction.
3. Assertions that re-prove the shared rule are deleted from the touched test files.
4. The existing interviewer-driven tests for request-next-round and stale review pass with the fake interviewer.

## Files

- `grill-room/actions/submit-round.ts` and `grill-room/actions/request-next-round.ts`, with their tests.
- `grill-room/server/stale-review.ts`, with its tests.

## Builds on

- `server/answer-change.ts` from ticket 01: settle, unsettle, withdraw, each accepting a handle.
- `server/session-state.ts`: `returnSessionToInterviewing`, which accepts a handle.
- `server/turn.ts`: `failIfTurnInProgress`.

## Verify

From `grill-room/`: `pnpm test` and `pnpm typecheck`, both green.

## Notes

`request-next-round.ts` is the most-changed file in the repo, and 02 and 03 run in parallel. Ticket 02 touches none of 03's files, so they can't conflict.
