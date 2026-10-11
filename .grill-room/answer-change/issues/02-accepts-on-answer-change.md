# 02 Move the three proposal accepts onto Answer change

Status: ready-for-agent
Blocked by: 01
Suggested model: sonnet

## What to build

Move the three accept actions onto Answer change, which ticket 01 builds. See the spec's Implementation Decisions.

- **accept-deferral → defer**, with the proposal's deferral reason.
- **accept-restatement → reword**, with the edited or proposed text, the restatement notes and the restatement reason. Remove its direct calls that withdraw supersessions and mark the spec not current; reword does both now.
- **accept-supersession → settle with settled-by**, on the branch that settles a loose end from another decision's answer. That settle uses kind `own-answer` and the supersession answer. The other branch, which marks a decision replaced, stays as it is.
- **Turn lock.** Add the turn-in-progress check to all three actions.

Every existing refusal code and status stays unchanged: `no-deferral`, `no-restatement`, `no-supersession`, `empty-statement`, and the not-found refusals.

## Behaviour (through the actions)

| Start state | Call | Expected |
|---|---|---|
| decision with a pending deferral and a pending restatement, on a confirmed session with a current spec | accept-deferral | kind deferred; the restatement proposal cleared; claims withdrawn; spec not current |
| decision with a pending restatement and a pending deferral; decision Z replaced by it; settled-by Y | accept-restatement | answer reworded; deferral cleared; Z's replaced-by kept; settled-by Y kept |
| decision answered "A" (accepted-recommendation) | accept-restatement | history row records kind accepted-recommendation, not own-answer |
| loose end with a pending supersession by decision Y | accept-supersession | answer is the supersession answer; settled-by Y; other proposals cleared; spec not current |
| decision with a supersession proposal of the replaced kind | accept-supersession | unchanged from today: replaced-by set; no history row |
| a turn is running | any of the three | 409 `turn-in-progress`; nothing written |

## Pattern to copy

The answer-decision migration in ticket 01: the action checks its preconditions, then makes one Answer change call.

## Acceptance

1. Each row of the behaviour table has its own test in the action's test file.
2. Each action keeps its existing precondition tests, and they pass unchanged.
3. Assertions that re-prove the shared rule are deleted from the three test files.

## Files

- `grill-room/actions/accept-deferral.ts`, `accept-restatement.ts` and `accept-supersession.ts`, with their tests.

## Builds on

- `server/answer-change.ts` from ticket 01: defer, reword, settle (with settled-by).
- `server/turn.ts`: `failIfTurnInProgress`.

## Verify

From `grill-room/`: `pnpm test` and `pnpm typecheck`, both green.
