# 03 Move round submission, next-round and stale review onto Answer change

Status: ready-for-agent
Blocked by: 01
Suggested model: opus

## Intent

Submitting a round, opening the next one and reviewing stale decisions each change several answers in one operation. Today they write by hand, and none in a transaction (spec: `.grill-room/answer-change/spec.md`). Ticket 01 built **Answer change** (`grill-room/server/answer-change.ts`), whose transitions take a caller's transaction handle. This ticket moves these callers onto it, each making all of its changes in one transaction.

## What to build

Every transition call passes `db: tx`, the caller's transaction. Every other write in the same transaction goes through `tx` too, never `getDb()`. Reads that come before a block (`loadDecisions`, the stamp `applyReviews` computes) stay before its transaction (the reviewer checks this in the diff; no test pins it). `store` opens its transaction on every call, even when the proposal has nothing to write.

- **submit-round.**
  - After the existing refusals, read the round's session (it always exists: the foreign key guarantees it; use `session!` as answer-decision does) and call `failIfTurnInProgress(session, "The interviewer is working on this session. Wait for the turn to finish before submitting a round.")`.
  - In one transaction: for each placement, `settle(placement.decisionId, { answer: placement.draftAnswer, kind: placement.draftAnswerKind }, { now, db: tx })`, then the round's update to `submitted`.
  - `requestNextRound.run` stays after the transaction commits.
  - Expected side effect: a card dispositioned while its round was open (disposition-decision accepts a never-answered frontier decision) used to keep its stale `dispositionTarget` when the round was submitted. settle now clears it.
- **request-next-round, opening a round** (the block from `returnSessionToInterviewing` to the `pendingAsk` update). One transaction holds:
  - `returnSessionToInterviewing(session, now, tx)`, when the session is not interviewing;
  - `unsettle(row.id, { now, db: tx })` for each returning deferred decision, replacing today's hand-written history insert and update. reopenedAt stays unchanged, because a deferred decision was not settled;
  - the rounds insert, the roundDecisions insert and the `pendingAsk` update.
- **request-next-round, push-backs** (inside `store`). Each pushed-back decision gets `withdraw(row.id, { now, reason: response.explanation, db: tx })`, replacing today's history insert and `withdrawnAt` update.
  - `store`'s writes up to its done scan (the proposed-decision inserts, the push-backs and the user-decision placements) run in one transaction.
  - `findSupersessionsForDone` is a model call, so it and the `done-proposed` session update stay outside, after the commit.
- **Stale review, `applyReviews`** (`server/stale-review.ts`). Each call to `applyReviews` runs in one transaction.
  - **Re-ask:** `unsettle(row.id, { now, reason, db: tx })` first, where `reason` is `review.reason`, or undefined when it is blank. Then the caller's own `tx` update writes the question fields only: `questionTitle`, `questionBody`, `offeredChoicesJson`, `choiceRationalesJson`, `recommendedChoice` and `recommendedAnswer`, each computed as today, plus `updatedAt`. It no longer writes the answer fields, `reopenedAt` or the cleared fields: unsettle owns those. (No test can see a leftover write of those fields, since unsettle has already written the same values; the reviewer checks it in the diff.) The order matters: history records the question as it was asked.
  - A re-asked decision always has a settling kind (only a settled decision can go stale), so unsettle always stamps `reopenedAt`.
  - Delete the hand-rolled claim withdrawal after the re-ask update. unsettle does it now.
  - Today's history insert at the top of the review loop moves into the reconfirm branch: unsettle writes the re-ask's history row, so a re-ask must not get a second one.
  - **Reconfirm stays outside Answer change, unchanged:** today's history row (the answer, its kind, the interviewer's reason) and the `settledAt` re-stamp, both through `tx`. The owner ruled to keep the history row.

Every existing refusal code and status stays unchanged. In submit-round they are: not found (404), `round_already_submitted` (409), `round_incomplete` (409).

## Behaviour

| # | Start state | Call | Expected |
|---|---|---|---|
| 1 | round placing decision D, which already had answer "A" (own answer; seeded directly for brevity); draft "B", own answer; another decision Y has a pending supersession by D | submit-round | D answer "B"; one history row with "A"; Y's supersession cleared |
| 1b | round placing decision Q, seeded directly with kind `dispositioned`, answer "not now" and `dispositionTarget` `out-of-scope`; draft "C", own answer | submit-round | Q answer "C", kind `own-answer`, `dispositionTarget` null; one history row with "not now", kind `dispositioned` |
| 2 | round placing a never-answered decision | submit-round | answer set; no history row (guard row) |
| 3 | round with draft kind `unknown` | submit-round | settledAt null (guard row) |
| 4 | whole-round, `done-proposed` session with a current spec and an open round seeded directly; the scripted interviewer's next turn proposes nothing more | submit-round | spec not current. Leaving `done-proposed` does not mark the spec (only leaving `confirmed` does, `session-state.ts`), so only the settle can |
| 5 | session turn `working`, round complete | submit-round | 409 `turn-in-progress`, the message above; no decision changed, round still open |
| 6a | session turn `working`, round already submitted | submit-round | `round_already_submitted`, not `turn-in-progress` |
| 6b | session turn `working`, round incomplete | submit-round | `round_incomplete`, not `turn-in-progress` |
| 7 | round of two placements, seeded directly; the first placement's decision had answer "A"; the second placement's settle fails on its main `decisions` update (the 4th `decisions` update in the transaction: each settle makes three, its own and two claim withdrawals) | submit-round | neither decision changed, no history row, round still open |
| 8 | seeded directly (an interviewer cannot propose done while a deferral is on the frontier): one-at-a-time session, `done-proposed`, with a current spec and no open round; deferred decision D (answer "later", reopenedAt T0) is the only candidate and returns; Y is settled (own answer) with a pending replacement by D (`supersededById` D, `supersessionAnswer` null); Z is settled (own answer) and replaced by D | request-next-round | D answer and kind null; reopenedAt still T0; one history row with "later", kind `deferred`; Y's supersession cleared; Z's `replacedById` null; spec not current |
| 8b | whole-round session, `interviewing`; deferred decision E whose answer is `""` (a deferral with no text, so only its kind counts as a prior answer); the scripted interviewer proposes nothing more | request-next-round | E returns in the new round; one history row with answer `""`, kind `deferred` |
| 9 | the start state of row 8, with the roundDecisions insert failing | request-next-round | D, Y and Z unchanged, no history row, no new round, session still `done-proposed`, spec still current |
| 10 | whole-round session, `interviewing`, with a current spec (a round opening does not mark it, since the session is not leaving `confirmed`); the scripted interviewer returns a push-back response on P that withdraws it with no replacement (explanation "x"); P's kind is `pushed-back` with answer "too vague", its own pending supersession by V, and `settledById` W and `replacedById` U seeded; Y has a pending supersession by P; Z is replaced by P | request-next-round | P `withdrawnAt` now, answer and kind kept; one history row: answer "too vague", kind `pushed-back`, reason "x"; P's own supersession cleared, `settledById` and `replacedById` null; Y's supersession cleared; Z's `replacedById` null; spec not current |
| 10c | whole-round session; the scripted interviewer pushes back on N, a never-answered decision (the validator allows a push-back response on any key) | request-next-round | N `withdrawnAt` now; **no** history row (owner ruling: no prior answer, no history row). Today's code writes one, so this row fails on the old code |
| 10b | the start state of row 10 plus a user-added decision UA awaiting placement; the scripted proposal also adds one decision and places UA, with that placement's `decisions` update failing (the 4th `decisions` update in the transaction: the push-back's withdraw makes three) | request-next-round | the call rejects; assert the rollback only: P unchanged, no history row, the proposed decision not inserted |
| 11 | session with a current spec; S's reopened ancestor carries `reopenedAt` 2099-01-01, so the review's stamp is that and not the clock; stale decision S (settled, kind own answer) re-asked with a new title and reason "r", while Z is replaced by S and Y has a pending supersession by S | stale review | S answer, kind and settledAt null; reopenedAt equals 2099-01-01, the review's stamp; title rewritten; exactly one history row, holding the **old** title and the review's reason; Z's `replacedById` null; Y's supersession cleared; spec not current |
| 11b | as row 11, with reason `"  "` | stale review | the history row's `interviewerReason` is null, not `"  "` |
| 12 | seeded like row 11 (ancestor `reopenedAt` 2099-01-01), session with a current spec; stale decision S (own answer "A") reconfirmed with reason "still holds", while Z is replaced by S and Y has a pending supersession by S | stale review | settledAt equals 2099-01-01, the review's stamp; one history row with answer "A", kind `own-answer`, reason "still holds", as today; reopenedAt unchanged; Y's supersession and Z's `replacedById` kept; spec still current |
| 12b | as row 12, with reason `"  "` | stale review | the reconfirm's history row has `interviewerReason` null, as today |
| 13 | a review of two re-asks; the second re-ask's question update fails (the 8th `decisions` update in the transaction: each re-ask makes three in unsettle, then its question update) | stale review | the call rejects; assert the rollback only: neither decision changed, no history row |

**Rows 11, 11b, 12, 12b and 13 seed their staleness directly**: set the ancestor's `reopenedAt` and leave S settled, insert the spec row current last, and never call `reopen-decision` (which would mark the spec itself and blind the spec assertions). They call `runDueStaleReviews(sessionId)` directly, on an `interviewing` session, with the review scripted on the fake interviewer; row 13's "the call rejects" means that call.

Rows 2, 3, 8b, 11b, 12 and 12b are guard rows: they pass on today's code and keep the migration from regressing. Prove each by a planted edit:
- row 2: insert a history row for every placement in submit-round;
- row 3: pass `kind: "own-answer"` for every placement in submit-round's settle call;
- row 8b: hand-write the returning deferral's history insert, gated on `row.currentAnswer` being non-empty;
- row 11b: pass `reason: review.reason` to unsettle;
- row 12: route the reconfirm through `settle`, which withdraws the claims and marks the spec not current;
- row 12b: write the reconfirm's history reason as `review.reason` unmapped. Row 8b also passes today; it guards that a deferral with no text still counts as a prior answer through this caller. Row 11's history assertions also pass on today's code; the mutation they catch is calling unsettle after the question update, which puts the new title in history. Its "spec not current" is new.

## Transaction routing

PGlite runs every query on one connection, so a rollback test cannot tell a write that skips `tx` from one that uses it: the stray write rolls back too. Each caller therefore gets a recording-handle test as well, asserting that every query between the transaction's start and commit went through `tx`, in order. The start states, so every branch is recorded:
- submit-round: a `done-proposed` session, a round of two placements, one of which had an answer.
- request-next-round, opening a round: row 8's start state.
- `store`, push-backs: a user-added decision UA awaiting placement, and a proposal with one proposed decision, one push-back response withdrawing row 10's P with no replacement (kind `pushed-back`, answer "too vague", so the span holds its history insert) and the placement of UA.
- `store`, done: a done proposal with nothing else in it (whole-round session, nothing left to ask). `store` still opens its transaction, so the log has a span to compare. The log shows `store`'s `commit` before the first query of the done scan, so the model call never runs inside the transaction. Prove it by planting the `findSupersessionsForDone` call inside the transaction.
- `applyReviews`: one review holding a re-ask, then a reconfirm, in that order.

Each routing test asserts the exact ordered list of entries in its span, as `actions/reopen-decision.test.ts` › "runs every query of the reopen through one transaction's handle" does.

**Slicing the log.** Each routing test asserts the span of one transaction: from its `db transaction` entry to its `commit`. A test may run other transactions first (in whole-round mode `store` runs before the opening block, and a due stale review runs before both); it picks its own as the transaction holding its first expected write. The done test has no write: its transaction is the only `db transaction` entry in that run. Row 8's and the opening block's routing test run one-at-a-time, so no `store` transaction precedes it.

**Fault counts.** "The Nth `decisions` update" counts from the start of the transaction under test: the harness resets its counter on that transaction's `db transaction` entry, so setup writes never count.

**The harness.** The recording and fault-injecting database mock exists only in `actions/reopen-decision.test.ts` (its `vi.hoisted` and `vi.mock` block). Copy it into each test file that needs it and extend it to fail a chosen `decisions` update or `roundDecisions` insert by call count. Do not add a shared helper outside the Files list.

## Pattern to copy

- **Caller's transaction around transitions and its own writes:** `reopenDecisionCore` since ticket 01 (`grill-room/actions/reopen-decision.ts`).
- **Recording-handle test:** `actions/reopen-decision.test.ts` › "runs every query of the reopen through one transaction's handle".
- **Rollback test with a throwing insert:** `actions/reopen-decision.test.ts` › "rolls back the reopen when placing it fails".
- **Refusal ahead of the lock:** `actions/answer-decision.test.ts` › "refuses a decision that is not a loose end before checking the turn lock".
- **Fake interviewer:** push-back and proposal tests in `actions/request-next-round.test.ts`; stale-review tests in `server/stale-review.test.ts` (from about line 134) and `actions/submit-round.test.ts` (about lines 489–1146).

## Acceptance

Each test must fail with the change it covers undone, except the guard rows named under the table. Rows 6a and 6b pass on today's code, which has no lock; prove each by a planted edit instead: move the session read and `failIfTurnInProgress` above that refusal, and the test must fail. Prove each recording-handle test by planting `getDb()` in place of `tx` in one write, except the `store` done test, whose span is empty: prove it by planting `findSupersessionsForDone` inside the transaction. Prove the submit-round routing test a second way too: plant `requestNextRound.run` inside the transaction, and it must fail.

1. **Every row.** One test per row (1b, 6a, 6b, 8b, 10b, 10c, 11b and 12b each their own), named "row N: …": rows 1–7 (1b included) in `actions/submit-round.test.ts`; rows 8, 8b, 9, 10, 10b and 10c in `actions/request-next-round.test.ts`; rows 11, 11b, 12, 12b and 13 in `server/stale-review.test.ts`.
2. **Transaction routing.** Five recording-handle tests, as listed under "Transaction routing": submit-round in `actions/submit-round.test.ts`; the round-opening block, `store` with push-backs and `store` with a done proposal in `actions/request-next-round.test.ts`; `applyReviews` in `server/stale-review.test.ts`.
3. **Replace, don't layer.** Delete the assertions that re-prove the shared rule where a row now covers them, namely: the returning-deferral history assertion in `actions/submit-round.test.ts` (around lines 316–343, rows 8 and 8b; rename that test to drop its history clause); the push-back history assertion in `actions/request-next-round.test.ts` (around lines 763–775, row 10). Keep the two re-ask tests in `server/stale-review.test.ts` (around lines 134–162): they pin that a re-ask clears the decision's own pending deferral and keeps Y's, which no row covers. Leave `actions/accept-supersession.test.ts` alone, though three of its tests (around lines 534, 575 and 664) overlap these rows: it belongs to ticket 02, which runs in parallel. Name each deleted assertion in the PR body. Keep the refusal tests, the interviewer-driven tests and the return-shape assertions.
4. **The existing interviewer-driven tests** pass: request-next-round's in `actions/request-next-round.test.ts`, and stale review's in `server/stale-review.test.ts` and `actions/submit-round.test.ts` (around lines 489–1146). They pass with the fake interviewer, updated only where they asserted the old behaviour (for example, a push-back that left its proposals in place), and each update named in the PR body.
5. **The whole suite passes.** A test outside the Files list that asserts the old behaviour is updated and named in the PR body.

## Files

- `grill-room/actions/submit-round.ts` and `grill-room/actions/request-next-round.ts`, with their test files.
- `grill-room/server/stale-review.ts`, with `grill-room/server/stale-review.test.ts`.
- `grill-room/AGENTS.md`: the `submit-round` and `request-next-round` rows only. submit-round gains: a decision that had an answer records it in history, claims naming it are withdrawn, the spec is marked not current, the whole submission lands in one transaction, and the `turn-in-progress` (409) refusal after every other refusal. request-next-round gains: a returning deferral and a pushed-back decision each withdraw the claims naming them (a push-back on a never-answered decision records no history row) and mark the spec not current, a pushed-back decision's own proposals and links are cleared, a stale re-ask withdraws claims and marks the spec not current the way a reopen does, and each block of writes lands in one transaction.
- Not `server/answer-change.ts`: ticket 01 owns it. If it needs a change, stop and report.
- Not ticket 02's files (the three accept actions).

## Builds on

- `grill-room/server/answer-change.ts`: `settle`, `unsettle`, `withdraw`, each taking `db`.
- `grill-room/server/session-state.ts`: `returnSessionToInterviewing`, which takes a handle.
- `grill-room/server/turn.ts`: `failIfTurnInProgress`.
- `grill-room/actions/reopen-decision.ts`: `reopenDecisionCore`, the transaction to copy.

## Verify

From `grill-room/`, run `pnpm test`, `pnpm typecheck` and `pnpm lint`; all three must pass. No UI change, so no `just e2e`.

## Open questions

None. The owner settled these:
- a reconfirm keeps today's history row (spec story 34);
- a push-back on a never-answered decision writes no history row, by the general rule;
- the turn lock comes after every existing refusal, each pinned by its own test.

A model call never runs inside a transaction: a turn can take minutes, and PGlite's single connection would block every other query meanwhile.

## Notes

`request-next-round.ts` is the repo's most-changed file. Tickets 02 and 03 share no file except `grill-room/AGENTS.md`, where each changes different rows.
