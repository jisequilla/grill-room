# 01 Build the Answer change module and move answer, disposition and reopen onto it

Status: ready-for-agent
Blocked by: none
Suggested model: opus

## What to build

Build the Answer change module described in the spec (`.grill-room/answer-change/spec.md`, Implementation Decisions). It has five named transitions: settle, defer, reword, unsettle and withdraw. All five share one core that applies the rule in the spec's transition table. Build all five now, so tickets 02 and 03 only migrate callers.

- **Shared core.** For every transition, it:
  - writes a history row holding the prior answer and its prior kind, plus the reason and notes passed in, only when the decision had a prior answer or kind;
  - clears the decision's own proposals;
  - clears its own links, except on reword;
  - withdraws claims: all of them, except on reword, which withdraws only the pending supersessions naming the decision;
  - marks the spec not current.
- **Per transition.** Each writes the answer state, settledAt and reopenedAt exactly as its row in the table says. Unsettle stamps reopenedAt only when the decision was settled.
- **Handles and timestamps.** Every transition accepts an optional database handle and a `now` from the caller. With no handle, it opens its own transaction.
- **Claim withdrawal.** The two claim-withdrawal helpers gain an optional database handle and keep their current behaviour without one.
- **Migrate three writers:**
  - answer-decision → settle;
  - disposition-decision → settle with kind `dispositioned` and its target;
  - reopen-decision's core → unsettle. Its return to interviewing and its round placement stay in reopen, inside the same transaction.
- **Turn lock.** Add the turn-in-progress check to answer-decision and disposition-decision.

Every existing refusal code and status in the three actions stays unchanged.

## Behaviour (through the module's interface)

| Start state | Call | Expected |
|---|---|---|
| decision with no answer and no kind | settle("A", own-answer) | answer A, settledAt now, **no** history row |
| decision answered "A" (accepted-recommendation) with a pending deferral and a settled-by link | settle("B", own-answer) | answer B; one history row with answer A and kind accepted-recommendation; deferral cleared; settled-by cleared |
| decision X answered; another decision Y has a pending supersession by X; decision Z is replaced by X | settle("B") on X | Y's supersession cleared; Z's replaced-by cleared |
| same as above | reword("A, more precisely") on X | Y's supersession cleared; **Z's replaced-by kept**; X's settled-by kept; X's kind unchanged; one history row |
| decision settled, session with a current spec | any transition | spec not current |
| session with no spec | any transition | no error, no spec row created |
| decision settled | unsettle | answer, kind and disposition target null; settledAt null; reopenedAt now |
| decision deferred (settledAt null) | unsettle | reopenedAt **unchanged** |
| decision answered | defer("later") | kind deferred; answer text kept; settledAt null; history row with reason "later" |
| decision answered | withdraw("pushed back") | withdrawnAt now; answer and kind kept; history row; claims withdrawn |
| settle with settled-by Y | settle("B", own-answer, settledBy Y) | links cleared, then settled-by is Y |
| any transition given a caller's transaction that then throws | — | no history row, no decision change, no claim withdrawn |

## Pattern to copy

- **Transaction-handle pattern:** the add-decision core and its tests, which add inside a given transaction and roll back with it. The session-state helpers take an optional handle the same way.
- **Turn-lock refusal tests:** the consistency-check action tests.

## Acceptance

Name each test so the line can cite it. Each test must fail when the code it covers is reverted.

1. Each row of the behaviour table has its own test in `server/answer-change.test.ts`.
2. The rollback row is proved by a test that runs a transition inside a caller's transaction and throws.
3. answer-decision and disposition-decision refuse with `turn-in-progress` (409) while a turn runs. Proved in their action tests.
4. Each migrated action has one smoke test proving the transition happened through the action. Assertions in their tests that re-prove the shared rule are deleted.
5. reopen-decision keeps returning the session to interviewing and placing the decision in a round. Its existing tests pass unchanged, apart from deleted shared-rule assertions.

## Files

- New: `grill-room/server/answer-change.ts` and `grill-room/server/answer-change.test.ts`.
- `grill-room/server/withdraw-claims.ts`.
- `grill-room/actions/answer-decision.ts`, `disposition-decision.ts` and `reopen-decision.ts`, with their tests.
- `grill-room/server/tree.ts`, only to update the doc comments on the cleared-field constants so they point at Answer change.

## Builds on

- `server/tree.ts`: `CLEARED_ANSWER_LINKS`, `CLEARED_PROPOSAL`, `CLEARED_SUPERSESSION`, `CLEARED_RESTATEMENT`, `isSettlingAnswerKind`.
- `server/withdraw-claims.ts`: `withdrawClaimsOn`, `withdrawSupersessionsNaming`.
- `server/session-state.ts`: `markSpecNotCurrent`, `returnSessionToInterviewing`, `DbHandle`.
- `server/turn.ts`: `failIfTurnInProgress`.
- `actions/add-decision.ts`: `addDecisionCore`, the transaction-handle pattern.

## Verify

From `grill-room/`: `pnpm test` and `pnpm typecheck`, both green. No UI change, so no `just e2e`.
