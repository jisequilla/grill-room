# 01 Build the Answer change module and move answer, disposition and reopen onto it

Status: ready-for-agent
Blocked by: none
Suggested model: opus

## Intent

Nine writers apply the answer-change rule by hand, each a different part of it, and none in a transaction (spec: `.grill-room/answer-change/spec.md`). This ticket builds **Answer change**, the one module that owns the rule, and moves the three simplest writers onto it, along with the two server callers of reopen's core. Tickets 02 and 03 only move callers.

## What to build

**The module, `server/answer-change.ts`.** It exposes five transitions. Each takes a decision id, its own arguments, and an options object `{ now, reason?, db? }`, and returns the decision row as written:

- `settle(id, { answer, kind, dispositionTarget?, settledById? }, opts)`
- `defer(id, opts)`
- `reword(id, { text, notes }, opts)`
- `unsettle(id, opts)`
- `withdraw(id, opts)`

Every transition runs one shared core, in this order:

1. **Read** the decision. An unknown id throws. The module checks no other precondition, such as a withdrawn decision or the session state: those stay with the callers.
2. **History.** When the decision had a prior answer, insert one history row:
   - `decisionId`, `questionTitle` and `questionBody`: copied from the decision;
   - `answer` and `answerKind`: the prior values, exactly as they stood;
   - `interviewerReason`: `opts.reason`, or null when not given;
   - `operatorNotes`: reword's `notes` (`""` stays `""`); null for every other transition;
   - `recordedAt`: `opts.now`.

   "Had a prior answer" means `currentAnswer` is non-empty, **or** `answerKind` is non-null.
3. **Write the decision** with the transition's answer state (table below). The same update:
   - spreads `CLEARED_PROPOSAL`, on every transition;
   - spreads `CLEARED_ANSWER_LINKS`, on every transition except reword;
   - then sets `settledById`, on a settle that was given one.
4. **Withdraw claims.**
   - reword withdraws only the pending supersessions naming the decision: rows whose `supersededById` is the decision.
   - Every other transition withdraws all claims: those supersessions, plus `replacedById` and `replacedReason` on every row whose `replacedById` is the decision.
   - No other row changes.
5. **Spec.** Mark the session's spec not current, whatever the session state. With no spec, do nothing. Never change the session row itself.

**Transactions.**
- With `opts.db`, every query, the read included, goes through that handle.
- Without one, the transition opens its own transaction with `getDb().transaction(async (tx) => …)`, and every query goes through that `tx`.

**Claim-withdrawal helpers.** `withdrawClaimsOn` and `withdrawSupersessionsNaming` gain an optional last `db` handle. Without one, they behave as today.

**The answer state each transition writes:**

| Transition | currentAnswer | answerKind | dispositionTarget | settledAt | reopenedAt | withdrawnAt |
|---|---|---|---|---|---|---|
| settle | `answer` | `kind` | the given target when `kind` is `dispositioned` (required then: a missing target throws), else null | `now` if `isSettlingAnswerKind(kind)`, else null | unchanged | unchanged |
| defer | unchanged | `deferred` | null | null | unchanged | unchanged |
| reword | `text` | unchanged | unchanged | unchanged | unchanged | unchanged |
| unsettle | null | null | null | null | `now` only if `isSettlingAnswerKind(prior kind)`, else unchanged | unchanged |
| withdraw | unchanged | unchanged | unchanged | unchanged | unchanged | `now` |

The disposition target belongs to the `dispositioned` kind:
- A transition that sets the kind sets the target with it: settle, defer, unsettle.
- A transition that keeps the kind keeps the target: reword, withdraw.

"Was settled", for unsettle, means `isSettlingAnswerKind(prior answerKind)`, the test tree derivation uses (`server/tree.ts:142`). It covers a stale decision and a settling kind with a null `settledAt`. It excludes a deferred one.

**Migrations:**

- **answer-decision → settle,** with kind `own-answer`. It returns the same view as today.
- **disposition-decision → settle,** with kind `dispositioned` and its target. It returns the same view as today.
- **reopen-decision's core → unsettle.** `reopenDecisionCore` splits into two parts:
  - **Before the transaction, unchanged:** its refusal checks (decision, session, the turn lock, the derived-state check) and its `now` (`reopenStamp`).
  - **Inside one transaction, all through its handle:**
    - the open-round select;
    - the placements count;
    - the unsettle;
    - `returnSessionToInterviewing`, when the session is not interviewing;
    - the round and roundDecisions inserts.
  - It runs `getCurrentRound` after the transaction commits.
- **The two other callers of reopen's core,** `server/reopen-batch.ts` and `actions/scout-project.ts`, need no code change: they inherit the rule through reopen's core. Their tests are updated only where they assert the old behaviour.
  - `reopen-batch` calls answer-decision only between its own awaited turns, while the session is idle, so the new turn lock never fires mid-batch.

**Turn lock.** answer-decision and disposition-decision load the decision's session, then call `failIfTurnInProgress` **after** every existing refusal and before any write. Every refusal they give today still wins, with its code and status unchanged. The session always exists: the decision's foreign key guarantees it.

**Docs.** In `grill-room/AGENTS.md`, update the `answer-decision`, `disposition-decision` and `reopen-decision` rows of the actions table to state:
- the history row;
- the withdrawn claims;
- the spec marked not current in any session that has one;
- the turn-in-progress refusal.

Leave the other rows and the batch notes as they are: what they say still holds.

Update the doc comments on the cleared-field constants in `server/tree.ts` to point at Answer change.

## Behaviour (through the module's interface)

**Fixture F**, used by the rows that name it:
- **Session S:** `done-proposed`, with a done summary, and a spec whose `current` is true.
- **Decision X:**
  - answer `"A"`, kind `accepted-recommendation`;
  - `settledAt` T1, `reopenedAt` T0 (earlier than T1);
  - `dispositionTarget` null;
  - `settledById` W, `replacedById` V with `replacedReason` "r".
- **X's proposals:** all three pending: `deferralReason` "d"; `restatementText` "t" with notes and reason; `supersededById` U with an answer and reason.
- **Decision Y:** `supersededById` X (a pending supersession by X).
- **Decision Z:** `replacedById` X with `replacedReason` "z".
- **Decision N:** `supersededById` U2 and `replacedById` V2, both naming decisions other than X.

Each row asserts every cell it names.
- **"Own proposals cleared":** all three: `deferralReason`; the restatement text, notes and reason; `supersededById` with its answer and reason.
- **"Session untouched":** S's state and done summary are as in F.

| # | Start | Call (`now` = T2) | Expected |
|---|---|---|---|
| 1 | F | `settle(X, {answer:"B", kind:"own-answer"})` | returns X as written; answer B, kind own-answer, `settledAt` T2, `reopenedAt` T0; own proposals cleared; `settledById`, `replacedById` and `replacedReason` null; one history row (answer A, kind accepted-recommendation, reason null, notes null, `recordedAt` T2); Y's supersession cleared; Z's `replacedById` null; N unchanged; spec not current; session untouched |
| 2 | F | `settle(X, {answer:"B", kind:"own-answer", settledById: Q})` | as row 1, except `settledById` Q |
| 3 | F | `settle(X, {answer:"B", kind:"unknown"})` | `settledAt` null |
| 4 | F with X kind `dispositioned`, target "open-question" | `settle(X, {answer:"B", kind:"dispositioned", dispositionTarget:"out-of-scope"})` | target "out-of-scope" |
| 5 | F with X kind `dispositioned`, target "open-question" | `settle(X, {answer:"B", kind:"own-answer"})` | target null |
| 6 | F | `defer(X, {reason:"later"})` | answer A kept; kind deferred; `settledAt` null; `reopenedAt` T0; own proposals and links cleared; history row with reason "later"; Y and Z cleared; N unchanged; spec not current |
| 7 | F with X kind `dispositioned`, target "open-question" | `defer(X)` | target null |
| 8 | F | `reword(X, {text:"A2", notes:""}, {reason:"tidy"})` | answer A2; kind accepted-recommendation; `settledAt` T1; `reopenedAt` T0; own proposals cleared; **`settledById` W and `replacedById` V kept**; history row with notes `""` and reason "tidy"; Y's supersession cleared; **Z's `replacedById` still X**; N unchanged; spec not current |
| 9 | F | `unsettle(X)` | answer, kind and target null; `settledAt` null; `reopenedAt` T2; own proposals and links cleared; history row; Y and Z cleared; N unchanged; spec not current |
| 10 | F with X kind `dispositioned`, target "open-question" | `unsettle(X)` | target null |
| 11 | F with X kind `deferred`, `settledAt` null | `unsettle(X)` | `reopenedAt` T0 |
| 12 | F with X `settledAt` null | `unsettle(X)` | `reopenedAt` T2 |
| 13 | F with X kind `dispositioned`, target "open-question" | `withdraw(X, {reason:"pushed back"})` | `withdrawnAt` T2; answer A, kind dispositioned and target "open-question" kept; `settledAt` T1; `reopenedAt` T0; own proposals and links cleared; history row with that reason; Y and Z cleared; N unchanged; spec not current |
| 14 | X with answer null, kind null | `settle(X, {answer:"A", kind:"own-answer"})` | no history row |
| 15 | X with answer `""`, kind null | `settle(X, …)` | no history row |
| 16 | X with answer null, kind `unknown` | `settle(X, …)` | one history row (answer null, kind unknown) |
| 17 | X with answer "A", kind null | `settle(X, …)` | one history row (answer A, kind null) |
| 18 | F with S `interviewing` | `settle(X, …)` | spec not current; session untouched |
| 19 | F with S `confirmed` | `settle(X, …)` | spec not current; session untouched |
| 20 | F with no spec row | `settle(X, …)` | no error; still no spec row |
| 21 | F; a recording handle (its table-name helper extended to name `decisionHistory`) inside a caller's transaction, which then throws | `settle(X, …, {db: recording})` | recorded, in order: select, insert history, update decisions, update decisions, update decisions, update specs; after rollback, every row as in F |
| 22 | F, no handle, with `getDb().transaction` spied | `settle(X, …)` | `transaction` called once; its `tx` received every select, insert and update |
| 23 | F, no handle; the spec update made to throw | `settle(X, …)` | throws; every row as in F |
| 24 | F | `settle(X, {answer:"B", kind:"own-answer", dispositionTarget:"out-of-scope"})` | target null |
| 25 | F | `settle(X, {answer:"B", kind:"dispositioned"})` | throws; every row as in F |

## Pattern to copy

- **Optional handle and recording-handle assertion:** `addDecisionCore` (`actions/add-decision.ts:33`), and its test "adds and returns the session to interviewing inside a given transaction, and rolls back with it" (`actions/add-decision.test.ts:234-270`), including its exact ordered-list assertion. Row 21 copies it.
- **Spying on `getDb().transaction`:** the recording mock in `actions/ask-consistency-findings.test.ts:40-60`. Row 22 copies it.
- **Turn-lock refusal test:** `actions/check-consistency.test.ts:638-650`.

## Acceptance

1. **The module's rows.** Rows 1–25 each have their own test in `server/answer-change.test.ts`, named "row N: …". Each must fail when the code its row covers is reverted. Row 20 is the exception: it is a guard row, and fails only for an implementation that throws or creates a spec when there is none.
2. **The new turn lock.** answer-decision and disposition-decision are each given a valid loose end and a valid answer or target, on a session whose `turnStatus` is `working`. Each refuses with code `turn-in-progress`, status 409, and reopen's message with its last words naming the action ("The interviewer is working on this session. Wait for the turn to finish before answering a decision." / "…before dispositioning a decision."), and writes no history row and changes no decision. Proved in each action's test file.
3. **answer-decision applies the rule.** X is a `deferred` loose end in a `done-proposed` session with a current spec, and has fixture F's Y and Z pointing at it. Answering it:
   - clears Y's supersession and Z's `replacedById`;
   - marks the spec not current;
   - returns the same view shape as today.

   Proved in `actions/answer-decision.test.ts` › "applies the answer change rule". Today's code does none of the first two, so the test fails with the change reverted.
4. **disposition-decision applies the rule.** The same check as 3, plus: a never-answered decision, once dispositioned, has no history row. Proved in `actions/disposition-decision.test.ts` › "applies the answer change rule".
5. **reopen marks the spec in any session.** reopen-decision in a `done-proposed` session with a current spec marks it not current. The existing test "leaves the spec alone when reopening a decision in a done-proposed session" (`actions/reopen-decision.test.ts:284`) is inverted into this test.
6. **reopen is atomic.** The fixture is a `done-proposed` session with a current spec and no open round. With the `roundDecisions` insert made to throw, reopen-decision leaves the decision, its history, the session's state, the spec and the rounds table exactly as before. Proved in `actions/reopen-decision.test.ts` › "rolls back the reopen when placing it fails".
7. **Shared-rule assertions move to the module.**
   - Delete from the three actions' test files the assertions on history rows, cleared links and proposals, and withdrawn claims.
   - Keep their refusal tests, their view and return-shape assertions, reopen's round placement and return to interviewing, and every assertion acceptances 2–6 require, history and claim assertions included.
8. **The whole suite passes.** `pnpm test` passes in full. A test outside the Files list that asserts the old behaviour of a reopen, answer or disposition is updated, and named in the PR body.

## Files

- New: `grill-room/server/answer-change.ts` and `grill-room/server/answer-change.test.ts`.
- `grill-room/server/withdraw-claims.ts`.
- `grill-room/actions/answer-decision.ts`, `disposition-decision.ts` and `reopen-decision.ts`, with their test files.
- Tests that call these three actions and may need an assertion updated (the list is complete as far as known; any other test is named in the PR body):
  - `grill-room/actions/`: `check-consistency.test.ts`, `repo-decisions.test.ts`, `apply-reopen-batch.test.ts`, `set-adr-worthy.test.ts`, `list-sessions.test.ts`, `list-loose-ends.test.ts`, `confirm-session.test.ts`, `accept-supersession.test.ts`, `ask-consistency-findings.test.ts`, `submit-round.test.ts`, `accept-deferral.test.ts`, `accept-restatement.test.ts`, `scout-project.test.ts`;
  - `grill-room/server/`: `stale-review.test.ts` and `interviewer/scenarios.test.ts`.
- `grill-room/server/tree.ts`: doc comments on the cleared-field constants only.
- `grill-room/AGENTS.md`: the three action rows only.
- Not `server/reopen-batch.ts` or `actions/scout-project.ts`: no change expected.
- Not `e2e/fixtures/demo-project/**`, which is a fixture repository, not app code.

## Builds on

- `server/tree.ts`: `CLEARED_ANSWER_LINKS`, `CLEARED_PROPOSAL`, `CLEARED_SUPERSESSION`, `CLEARED_RESTATEMENT`, `isSettlingAnswerKind`.
- `server/withdraw-claims.ts`: `withdrawClaimsOn`, `withdrawSupersessionsNaming`.
- `server/session-state.ts`: `markSpecNotCurrent`, `returnSessionToInterviewing`, `DbHandle`.
- `server/turn.ts`: `failIfTurnInProgress`.
- `actions/add-decision.ts`: `addDecisionCore`.
- `actions/reopen-decision.ts`: `reopenDecisionCore`, `reopenStamp`.

## Verify

From `grill-room/`, run `pnpm test`, `pnpm typecheck` and `pnpm lint`; all three must pass. There is no UI change, so no `just e2e`.

## Open questions

None. The owner settled these:
- the spec is marked not current in every session state;
- a decision with no prior answer gets no history row;
- the turn lock comes after the existing refusals;
- the reopen callers inherit the rule.

The disposition target follows the kind, as the answer-state table shows.
