# Answer change

Status: ready-for-agent

## Problem Statement

I own Grill Room and keep changing how decisions behave: new proposal kinds, new ways to settle or reopen a decision, new turns that rewrite the tree. Every one of those changes has to respect one rule. When a decision's answer changes, its prior answer goes to its history, its own proposals and links lapse, the claims other decisions make about it lapse, and a confirmed spec stops being current. No module owns that rule. A doc comment states it as a convention, and nine writers each spell it out by hand.

They no longer agree:
- Submitting a round never records a prior answer in history.
- Accepting a restatement or a supersession leaves other pending proposals on the decision.
- Answering, dispositioning, submitting a round and accepting a supersession leave other decisions' claims in place.
- Stale review hand-rolls its own copy of claim withdrawal.
- Only accepting a restatement marks the spec not current. Accepting a deferral on a confirmed session changes the tree under a spec that still reads as current.
- None of the writers runs in a transaction, so a failure part-way leaves a history row without the update, or an update whose claims were never withdrawn.
- Several user-facing writers can change the tree while the interviewer is mid-turn.

Each divergence is a bug I can't see until a session goes wrong. Every new writer is a fresh chance to forget a step. Testing the rule means testing nine actions, each of which inserts rows directly to set up its state.

## Solution

One module, **Answer change**, owns every write that gives a decision a new answer state. It exposes five named transitions: settle, defer, reword, unsettle and withdraw. Each applies the whole rule in one transaction. The actions keep their own preconditions and hand the change to Answer change, so the rule lives in one place and is tested once.

Behaviour the owner will notice:
- A round's re-answers show in history.
- Accepting any proposal or answer on a confirmed session marks the spec not current.
- Stale claims no longer outlive the answer they were about.
- Accepting, answering, dispositioning and submitting are refused while a turn is running, as reopening already is.

## User Stories

1. As the owner, I want every change to a decision's answer recorded in its history whenever it had a prior answer, so that I can see what a decision used to say.
2. As the owner, I want a decision's first answer to add no history row, so that history holds only answers that were replaced.
3. As the owner, I want re-answering a decision in a round to record the prior answer, so that round submissions are as traceable as single answers.
4. As the owner, I want a decision's pending proposals to lapse whenever its answer changes, so that I am never offered a supersession, deferral or restatement written about an answer that no longer stands.
5. As the owner, I want accepting a restatement to clear any pending deferral or supersession on the same decision, so that I don't accept a second proposal about the old wording.
6. As the owner, I want accepting a restatement to keep the decision's settled-by and replaced-by links, so that rewording an answer doesn't lose where it came from or what it replaced.
7. As the owner, I want accepting a restatement to keep other decisions' records of having been replaced by this one, so that a rewording doesn't revive decisions it already replaced.
8. As the owner, I want accepting a restatement to withdraw the pending supersessions that name this decision, so that no proposal quoting the old wording survives.
9. As the owner, I want every change of meaning to withdraw all claims naming the decision, so that other decisions stop pointing at an answer that is gone.
10. As the owner, I want answering a loose end to withdraw the claims naming it, so that a stale supersession proposal can't be accepted against the new answer.
11. As the owner, I want dispositioning a decision to withdraw the claims naming it, so that the tree stays consistent with the disposition.
12. As the owner, I want submitting a round to withdraw the claims naming every decision whose answer it changes, so that a round behaves like answering each decision on its own.
13. As the owner, I want a stale-review re-ask to withdraw claims the same way a reopen does, so that the two paths can't drift.
14. As the owner, I want an interviewer push-back to apply the whole rule (history, lapsed proposals and links, withdrawn claims), so that a withdrawn answer leaves nothing pointing at it.
15. As the owner, I want any answer change to mark the session's spec not current, so that a confirmed spec never silently disagrees with its decisions.
16. As the owner, I want accepting a deferral on a confirmed session to mark the spec not current, so that I know the spec needs re-synthesis.
17. As the owner, I want accepting a supersession on a confirmed session to mark the spec not current, for the same reason.
18. As the owner, I want answer changes on a session with no spec to have no spec effect and no error, so that interviewing is unaffected.
19. As the owner, I want unsettling a settled decision to mark it reopened, so that its dependents read as stale and get reviewed.
20. As the owner, I want a returning deferral to leave its dependents alone, so that bringing back a deferred question doesn't cascade stale reviews over decisions that never rested on it.
21. As the owner, I want settling a decision with a settled-by link (an accepted supersession of a loose end) to record where its answer came from, so that I can trace it.
22. As the owner, I want every answer change to apply all of its effects or none, so that a failure never leaves a half-applied change.
23. As the owner, I want a caller that makes several answer changes in one operation (a round submission, a next-round request, a stale review) to apply them all in one transaction, so that the tree is never left between two states.
24. As the owner, I want accepting a deferral, restatement or supersession to be refused while an interviewer turn is running, so that the tree doesn't change under the interviewer.
25. As the owner, I want answering or dispositioning a decision to be refused while a turn is running, for the same reason.
26. As the owner, I want submitting a round to be refused while a turn is running, for the same reason.
27. As the owner, I want every refusal an action gives today (not found, no pending proposal, empty answer, not a loose end, stale or unplaced decision, round already submitted or incomplete) to stay exactly as it is, so that the UI and the agent keep working.
28. As the agent operating the app, I want the action tools to keep their names, inputs and outputs, so that my existing calls keep working.
29. As a builder adding a new way to change an answer, I want to call one named transition and get the whole rule, so that I can't forget a step.
30. As a builder, I want to read the rule in one module, so that I don't have to reconstruct it from a doc comment and nine call sites.
31. As a builder, I want the rule proven by one test table at the module's interface, so that a change to the rule fails one obvious test.
32. As a builder, I want action tests to cover only each action's own preconditions and one check that the change happened, so that refactoring the rule doesn't break nine test files.
33. As a reviewer, I want each transition's effects stated as a table, so that I can check a diff row by row.
34. As the owner, I want reconfirming a decision in stale review to keep only re-stamping it as settled, so that a confirmation isn't recorded as a change.
35. As the owner, I want marking a decision replaced to stay a proposal concern, out of this module, so that the module covers answer changes only.
36. As the owner, I want returning the session to interviewing and placing a reopened decision in a round to stay with the callers that do them today, so that Answer change touches only decisions, their history and the spec's currency.

## Implementation Decisions

- **A new deep module, Answer change, on the server.** Five named transitions share one core. The core applies the shared rule, and each transition differs only in the answer state it writes and in what it keeps:

  | Transition | Answer state written | settledAt | reopenedAt | Own proposals | Own links | Claims naming it |
  |---|---|---|---|---|---|---|
  | settle (answer, kind, optional disposition target, optional settled-by) | the given answer and kind | now if the kind settles, else null | unchanged | cleared | cleared, then settled-by set when given | all withdrawn |
  | defer (reason) | kind `deferred`, answer text kept | null | unchanged | cleared | cleared | all withdrawn |
  | reword (text, notes, reason) | answer text replaced, kind kept | unchanged | unchanged | cleared | **kept** | **pending supersessions only** |
  | unsettle | answer, kind and disposition target cleared | null | now **only if it was settled** | cleared | cleared | all withdrawn |
  | withdraw (reason) | withdrawn now, answer and kind kept | unchanged | unchanged | cleared | cleared | all withdrawn |

  Every transition:
  - writes a history row holding the prior answer and its prior kind, with the reason and notes passed in, **only when the decision had a prior answer or kind**;
  - marks the session's spec not current, which does nothing when there is no spec.

- **Transactions.** Every transition accepts an optional database handle. With none, it opens its own transaction. With one, it runs inside the caller's transaction, so multi-change callers can be atomic. This follows the existing pattern of the add-decision core and the session-state helpers.
- **Claim withdrawal takes a handle.** The two claim-withdrawal helpers gain an optional database handle. Stale review's hand-rolled copy of claim withdrawal is deleted.
- **Timestamps come from the caller.** Reopen and stale review compute their own stamps, so a transition takes `now` from the caller.
- **Preconditions stay in the actions.** Not-found, no-pending-proposal, empty-answer, not-a-loose-end and similar refusals keep their codes and stay in each action. The turn-in-progress check also stays in the actions and is added to accept-deferral, accept-restatement, accept-supersession, answer-decision, disposition-decision and submit-round. Answer change can't own it, because stale review and next-round call it from inside a turn they hold.
- **Writer mapping:**
  - answer-decision → settle
  - disposition-decision → settle (kind `dispositioned`, with a target)
  - reopen-decision → unsettle; it keeps its own return to interviewing and its round placement
  - accept-deferral → defer
  - accept-restatement → reword
  - accept-supersession, settled-by branch → settle with settled-by
  - submit-round → settle for each changed decision, in one transaction
  - request-next-round, returning deferrals → unsettle
  - request-next-round, push-backs → withdraw
  - stale review, re-ask → unsettle, plus the caller's own rewrite of the question, in one transaction
- **Out of the module:** stale-review reconfirm, which only re-stamps settledAt; accept-supersession's replaced branch, which sets links rather than an answer and belongs to a future decision-proposal module; returning the session to interviewing; round placement.
- **The doc-comment convention on the cleared-field constants is replaced** by Answer change. The constants become internal to the rule wherever no other module needs them.
- **No schema change.** History already holds the answer, the answer kind, the interviewer's reason and the operator's notes.
- **Domain terms:** Answer change, Proposal, Claim and Reword, as defined in the repo's glossary.

## Testing Decisions

- **A good test** drives a transition through the module's interface against the in-memory database and asserts on the observable rows: the decision, its history, other decisions' proposal and replaced-by fields, and the spec's currency. It never asserts on which helper was called.
- **New seam, Answer change.** One table-driven test file covers:
  - each transition's row in the table above;
  - history written only with a prior answer;
  - spec currency with and without a spec;
  - reopenedAt only for a decision that was settled;
  - reword keeping links and replaced-by records while withdrawing pending supersessions;
  - settle with settled-by;
  - atomicity: a transition given a caller's transaction lands inside it and rolls back with it.
- **Existing seam, the actions.** Each migrated action keeps its precondition tests unchanged. It gains one smoke test that the transition happened through the action, and, where it is newly guarded, one turn-in-progress refusal test. Assertions in action tests that re-prove the shared rule are deleted in the same PR that migrates the action: replace, don't layer.
- **Prior art:**
  - the transaction tests in the add-decision action tests (adds inside a given transaction and rolls back with it);
  - the in-memory PGlite harness that runs the real migrations;
  - the turn-in-progress refusal tests in the consistency-check action tests.
- **Mutation gate.** Per ADR-0001, survivors on lines that an acceptance line claims are blockers. Each ticket's Evidence maps its acceptance lines to the module's lines.

## Out of Scope

- A decision-proposal module for the deferral, restatement and supersession lifecycle (architecture review candidate #6). It will call Answer change for accepts.
- A proposal-into-tree writer for inserting new decisions (candidate #8).
- A shared test builder for decision trees (candidate #10).
- Moving the turn-in-progress check into a module.
- Any change to what the interviewer proposes, to prompts or to schemas.
- Any UI change. The new turn-in-progress refusals reuse the existing refusal path.

## Further Notes

- The design came from an architecture review (`improve-codebase-architecture`) and a grill in the same conversation. The review ranked this candidate first, because it was the only one already causing behaviour to diverge.
- Accepting a deferral or a restatement used to record the prior kind as `own-answer` in history, whatever the actual prior kind was. Under the shared rule, history records the prior kind as it stood.
- The changes the owner will see are deliberate: re-answers in a round now appear in history; spec currency is now marked on every answer change; stale claims are withdrawn on answer and disposition; and more actions are refused while a turn runs. Each is a ruling from the grill, not a side effect.
