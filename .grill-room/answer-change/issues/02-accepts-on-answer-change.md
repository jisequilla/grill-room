# 02 Move the three proposal accepts onto Answer change

Status: ready-for-agent
Blocked by: 01
Suggested model: sonnet

## Intent

Accepting a deferral, a restatement or a supersession changes a decision's answer, so each accept must apply the whole answer-change rule (spec: `.grill-room/answer-change/spec.md`). Today each applies a different part of it by hand. Ticket 01 built **Answer change** (`grill-room/server/answer-change.ts`). This ticket moves the three accepts onto it, so each makes one call and checks nothing but its own preconditions.

## What to build

- **accept-deferral → `defer`.** Call `defer(row.id, { now, reason: row.deferralReason ?? undefined })`. Delete the hand-written history row, the update and the `withdrawClaimsOn` call.
- **accept-restatement → `reword`.** Call `reword(row.id, { text: edited || row.restatementText, notes }, { now, reason: row.restatementReason ?? undefined })`, where `notes` is computed as today (never null: `""` when the proposal's notes are blank). Delete the hand-written history row, the update, and the direct `withdrawSupersessionsNaming` and `markSpecNotCurrent` calls: reword does all of them.
- **accept-supersession, loose-end branch → `settle`.** This is the branch where the decision's kind does not settle. Call `settle(row.id, { answer: row.supersessionAnswer ?? "", kind: "own-answer", settledById: row.supersededById }, { now, reason: row.supersessionReason ?? undefined })`. Delete its hand-written history row and update.
- **accept-supersession, replaced branch: unchanged.** When the decision's kind settles, the action keeps today's update: `replacedById` and `replacedReason` set, the supersession cleared, no history row. This is not an answer change (spec, "Out of the module").
- **Descriptions.** Update each action's `description` string to say what it now does: claims withdrawn and the spec marked not current where that is new, and refused while a turn is working.
- **Turn lock.** Add `failIfTurnInProgress` to all three actions, after every existing refusal and before the write. Read the decision's session the same way answer-decision does since ticket 01.
  - accept-deferral: "The interviewer is working on this session. Wait for the turn to finish before accepting a deferral."
  - accept-restatement: "…before accepting a restatement."
  - accept-supersession: "…before accepting a supersession." The lock covers both branches.

Every existing refusal code and status stays unchanged: not found (404), `no-deferral` (409), `no-restatement` (409), `empty-statement` (400), `no-supersession` (409).

## Behaviour (through the actions)

Fixture: decision X in a `confirmed` session with a current spec. V and W are inserted settled decisions in the same session, so the links point at real rows. Y has a pending supersession by X (`supersededById = X`). Z is replaced by X (`replacedById = X`). W settled X (`X.settledById = W`).

| # | Start state | Call | Expected |
|---|---|---|---|
| 1 | X settled own answer "A", pending deferral (reason "later") and pending restatement | accept-deferral | X kind `deferred`, answer "A" kept, settledAt null; restatement cleared; X.settledById null; Y's supersession cleared; Z's `replacedById` null; spec not current; one history row: answer "A", kind `own-answer`, reason "later" |
| 2 | X settled `accepted-recommendation` "A", pending deferral | accept-deferral | history row's kind is `accepted-recommendation`, not `own-answer` |
| 3 | X settled own answer "A", pending restatement (text "A clean", notes "n", reason "r") and pending deferral | accept-restatement | answer "A clean", kind and settledAt unchanged; deferral cleared; X.settledById still W; Z's `replacedById` still X; Y's supersession cleared; spec not current; one history row: answer "A", notes "n", reason "r" |
| 4 | X settled `accepted-recommendation` "A", pending restatement | accept-restatement | history row's kind is `accepted-recommendation` |
| 5 | X a loose end (`unknown`, answer "dunno"), its own pending supersession by V with answer "B", reason "V answers it", and a pending deferral | accept-supersession | answer "B", kind `own-answer`, settledAt now, settledById V; supersession and deferral cleared; Y's supersession cleared; Z's `replacedById` null; spec not current; one history row: answer "dunno", kind `unknown`, reason "V answers it" |
| 6 | X a never-answered loose end (no answer, no kind), its own pending supersession by V with `supersessionAnswer` null | accept-supersession | answer `""`, kind `own-answer`, settledById V; **no** history row |
| 7 | X settled own answer, pending supersession of the replaced kind by V | accept-supersession | unchanged from today: `replacedById` V, `replacedReason` set, supersession cleared, answer and `settledAt` unchanged, no history row, spec still current |
| 8 | the start state of row 1, row 3, row 5 and row 7 (four tests: accept-supersession gets one per branch), session turn `working` | the matching accept | 409 `turn-in-progress`, the message above; no history row, no decision changed |
| 9 | session turn `working`; for `no-deferral`, `no-restatement` and `no-supersession`, no such proposal pending; for `empty-statement`, a restatement pending and `statement: "   "` | the matching accept | the existing code and status, not `turn-in-progress` |
| 10 | as row 3, but the restatement's notes are `"  "` | accept-restatement | history row's `operatorNotes` is `""`, not null |
| 11 | as row 3, with `statement: " B "` | accept-restatement | answer "B" |

## Pattern to copy

- **The migration:** answer-decision since ticket 01 (`grill-room/actions/answer-decision.ts`): refusals, then the session read and `failIfTurnInProgress`, then one Answer change call.
- **"Applies the answer change rule" smoke test:** `actions/answer-decision.test.ts` › "applies the answer change rule".
- **Refusal ahead of the lock:** `actions/answer-decision.test.ts` › "refuses a decision that is not a loose end before checking the turn lock", and "refuses an empty answer before checking the turn lock".

## Acceptance

Each test must fail with the change it covers undone. Row 9's tests pass on today's code, which has no lock; prove each by a planted edit instead: move the session read and `failIfTurnInProgress` above that refusal, and the test must fail.

1. **Rows 1–8, 10 and 11.** One test per row in the action's test file, named "row N: …" (row 8 is four tests). Some rows pass on today's code too, and are proved by a planted edit instead of the revert:
   - rows 10 and 11 guard the call's arguments: plant `notes: row.restatementNotes` and `text: row.restatementText`;
   - row 7 guards the replaced branch staying outside Answer change: plant a `settle` call on that branch, and the test must fail on `settledAt`, the history row or the spec.

   Rows 2 and 4 take the prior kind from the module, so no edit in the action can break them; the revert proves them, since today's code writes `own-answer`.
2. **Row 9.** One test per refusal named there, in its action's test file, each proved by the planted edit. The not-found refusal (404) needs no row: the existing "throws for a decision id that does not exist" tests already fail if the lock moves above it, since the session read would throw.
3. **Precondition tests unchanged.** Each action's existing refusal tests pass as they are.
4. **Replace, don't layer.** Delete a whole test only when every assertion in it is a history field, a cleared link or proposal, a withdrawn claim or the spec mark that rows 1, 3, 5 and 6 now cover. In a test that mixes those with anything else, delete only those assertions and keep the test. Name each deleted test in the PR body. Keep, as well:
   - the `CLEARED_PROPOSAL` constants test (`accept-deferral.test.ts` around line 441);
   - "becomes a deferred loose end", the no-staleness tests, and the tests that compare with reopen (`accept-deferral.test.ts` around lines 150, 289 and 414; `accept-restatement.test.ts` around lines 217 and 326);
   - "accept-deferral beside a restatement" (`accept-restatement.test.ts` around line 497);
   - every refusal test and return-shape assertion;
   - the tests of what reaches the interviewer (`accept-restatement.test.ts` around lines 405–495);
   - the next-round re-ask after an accepted deferral (`accept-deferral.test.ts` around line 175);
   - the regression that a replacement proposed after a deferral never settles as an empty answer (`accept-deferral.test.ts` around line 240);
   - every test that exercises another action (dismiss, answer, reopen, submit-round, stale review), such as most of `accept-supersession.test.ts` from line 339.
5. **The whole suite passes.** A test outside the Files list that asserts the old behaviour of an accept is updated and named in the PR body.

## Files

- `grill-room/actions/accept-deferral.ts`, `accept-restatement.ts` and `accept-supersession.ts`, with their test files.
- `grill-room/AGENTS.md`: the `accept-deferral`, `accept-restatement` and `accept-supersession` rows only. Each gains: claims withdrawn and the spec marked not current (accept-deferral, and accept-supersession's loose-end branch, are new for both), history records the prior kind as it stood, the decision's own other pending proposals lapse (accept-restatement, and accept-supersession's loose-end branch), and the `turn-in-progress` (409) refusal after every other refusal.
- Not `server/answer-change.ts`: ticket 01 owns it. If it needs a change, stop and report.

## Builds on

- `grill-room/server/answer-change.ts`: `defer`, `reword`, `settle` (with `settledById`), `AnswerChangeOptions`.
- `grill-room/server/turn.ts`: `failIfTurnInProgress`.
- `grill-room/actions/answer-decision.ts`: the session read and turn lock to copy.

## Verify

From `grill-room/`, run `pnpm test`, `pnpm typecheck` and `pnpm lint`; all three must pass. No UI change, so no `just e2e`.

## Open questions

None. The owner settled these in the grill and on ticket 01:
- history records the prior kind as it stood, not `own-answer` (spec, Further Notes);
- the turn lock comes after every existing refusal, each pinned by its own test;
- accept-supersession's replaced branch stays out of Answer change.
