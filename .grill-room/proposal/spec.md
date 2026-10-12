# Proposal

Status: ready-for-agent

## Problem Statement

I own Grill Room. The interviewer proposes changes to decisions I have already answered: that a loose end is answered by a later decision, that a settled decision has been replaced by a later one, that an answer is really a deferral, or that it holds notes and should be restated cleanly. Each of these is a Proposal, and I accept or dismiss it. Nothing owns that lifecycle.

- Proposals are written in one place, but cleared in many, each a different way. One dismiss spreads a named constant, one writes the columns by hand although a constant exists, and one has no constant at all.
- Which proposals may sit on one decision together is not a rule anywhere. It is a comment plus selection filters that disagree with each other. A rescan silently overwrites a pending answered-by or replacement I have not looked at yet.
- Dismissing is forgotten at once. The next scan can offer me the very proposal I just turned down, and I have to dismiss it again.
- A dismiss can run while the interviewer's turn is still storing proposals, because the dismiss actions ignore the turn lock and the scan stores its proposals as separate writes with no re-check.
- Accepting a replacement leaves the decision's other pending proposals in place and leaves the spec marked current, although the export and the tickets read the replacement link.
- "Proposal" also names the interviewer's round output, so the code says "proposal" for two unrelated things.

## Solution

One Proposal module owns every Proposal from the moment it is stored to the moment it is accepted or dismissed, and owns the rule of which decision may hold which Proposal.

- A decision holds at most one pending Proposal. A decision that holds one is not offered again until I accept or dismiss it, so nothing is overwritten behind my back.
- The Proposal's kind is stored, not guessed from which columns happen to be set.
- When I dismiss a Proposal, the decision remembers it for as long as its answer stands, and the interviewer's next scan does not offer it again. I can see what I dismissed on the decision, and forget a dismissal if I change my mind, so the next scan may offer it again.
- Accepting, dismissing and forgetting all refuse while an interviewer turn is working.
- A scan stores its Proposals in one transaction and skips any decision that stopped being eligible while the interviewer was thinking.
- Accepting a replacement also lapses the decision's other pending Proposals and marks the spec not current.
- The interviewer's round output is renamed the round proposal everywhere in the code.

## User Stories

1. As the owner, I want a decision to hold at most one pending Proposal, so that I never face two competing suggestions about the same answer.
2. As the owner, I want a decision that already holds a pending Proposal to be left out of the next scan, so that a Proposal I have not reviewed is never silently replaced.
3. As the owner, I want a pending answered-by on a loose end to stay as it is when the interviewer scans again, so that what I see does not change while I am deciding.
4. As the owner, I want a pending replacement on a settled decision to stay as it is when the interviewer scans again, for the same reason.
5. As the owner, I want every Proposal to carry its kind (answered-by, replacement, deferral or restatement), so that the app never has to guess which kind it is from which fields are set.
6. As the owner, I want my existing pending Proposals to keep working after the upgrade, so that nothing I was about to review disappears.
7. As the owner, I want the upgrade to stop and name the decisions if any of them holds two Proposals at once, so that nothing is dropped silently and I can dismiss one and run it again.
8. As the owner, I want dismissing a Proposal to be remembered against the decision's current answer, so that the interviewer does not offer it to me again.
9. As the owner, I want a dismissed deferral to stop the decision being offered for deferral until its answer changes, so that I am not asked twice.
10. As the owner, I want a dismissed restatement to stop the decision being offered for restatement until its answer changes.
11. As the owner, I want a dismissed answered-by to be remembered with the decision that would have answered it, so that a different later decision can still propose an answer.
12. As the owner, I want a dismissed replacement to be remembered with the decision that would have replaced it, so that a different later decision can still propose a replacement.
13. As the owner, I want every remembered dismissal on a decision to be forgotten when its answer changes (settled, deferred, reworded, unsettled or withdrawn), so that a new answer gets a fresh look.
14. As the owner, I want a Proposal I dismissed to be dropped quietly when the interviewer proposes it again, so that the interviewer's turn does not fail or retry because of my dismissal.
15. As the owner, I want to see on a decision which Proposals I dismissed for its current answer, with the kind, the decision it named, the interviewer's reason, when I dismissed it, and for a restatement the text I turned down, so that I know why it is not being offered.
16. As the owner, I want a Forget control beside each dismissed Proposal, so that I can let the interviewer offer it again.
17. As the owner, I want forgetting a dismissal to change nothing else (no answer, no history, no spec currency), so that it is a safe thing to click.
18. As the owner, I want forgetting to refuse while an interviewer turn is working, so that it never races a scan.
19. As the owner, I want dismissing a deferral, a restatement or a supersession to refuse while an interviewer turn is working, so that it never races the scan that is storing Proposals.
20. As the owner, I want every refusal the dismiss actions give today to stay exactly as it is and to come before the turn lock, so that the UI and the agent keep working.
21. As the owner, I want every refusal the accept actions give today to stay exactly as it is, so that nothing I rely on changes.
22. As the owner, I want accepting a deferral, a restatement or an answered-by to work exactly as it does today, through Answer change, so that the answer-change rule still holds.
23. As the owner, I want accepting a replacement to lapse the decision's other pending Proposals, so that no Proposal about an answer that was replaced survives.
24. As the owner, I want accepting a replacement to mark the session's spec not current, because the export and the tickets read the replacement.
25. As the owner, I want accepting a replacement to leave the answer, its settled time and its history as they are, because the answer did not change.
26. As the owner, I want a scan's Proposals to be stored all together or not at all, so that a failure never leaves half a scan behind.
27. As the owner, I want a scan to skip a decision whose answer changed while the interviewer was thinking, so that a Proposal about an answer that no longer stands is never stored.
28. As the owner, I want a scan to skip a decision that gained a Proposal while the interviewer was thinking, so that the at-most-one rule holds even across concurrent work.
29. As the owner, I want a skipped decision to be skipped silently, not to fail the scan, so that the rest of the scan's Proposals still reach me.
30. As the owner, I want a Proposal to never block confirming the session, as today.
31. As the owner, I want the accept and dismiss buttons, and the cards that show pending Proposals, to look and behave as they do today.
32. As a maintainer, I want one module to be the only writer of Proposal fields, so that the rule of what may be pending is enforced in one place.
33. As a maintainer, I want the module's interface to be small: read the pending Proposal, propose, accept, dismiss, forget a dismissal. With at most one pending Proposal, accept and dismiss need no kind.
34. As a maintainer, I want the six accept and dismiss actions to stay, each checking that the pending kind is its own and then calling the module, so that every action name, refusal code and UI call stays the same.
35. As a maintainer, I want the module to take an optional database handle, as Answer change does, so that a caller holding a transaction can compose it.
36. As a maintainer, I want the eligibility rule (which decisions may be offered for which kind) to live in the module, so that the scan's candidate lists and its store-time recheck use the same rule.
37. As a maintainer, I want the interviewer turn (its prompt, its retries, the wording of the reasons it is sent back) to stay in the supersession code and call the module, so that the module is about Proposals, not about the model.
38. As a maintainer, I want the interviewer's round output called the round proposal in the code (its validator, its turn, its retry, its type), so that "Proposal" means one thing.
39. As a maintainer, I want the glossary to define Dismissal, Round proposal, Delegation proposal and Scout proposal, so that the remaining senses of "proposal" are named.
40. As a maintainer, I want dismiss-supersession to have its own test file, which it lacks today.

## Implementation Decisions

- **The Proposal module** is a new deep module. Its interface:
  - `pendingProposal(row)` reads the decision's pending Proposal, if any, as a tagged value: its kind and that kind's payload.
  - `propose(id, proposal, opts)` stores one Proposal, refusing (as a skip result, not an exception) when the decision is not eligible for that kind, already holds a Proposal, or has a remembered dismissal that matches.
  - `accept(id, opts)` accepts whatever is pending. Answered-by goes to Answer change's settle (own-answer, settled-by the answering decision), deferral to defer, restatement to reword (with the owner's edited statement and the notes passed in opts), and replacement stays in this module (see below).
  - `dismiss(id, opts)` clears the pending Proposal and records it as a remembered dismissal.
  - `forgetDismissal(id, dismissal, opts)` removes one remembered dismissal.
  - Eligibility per kind is part of the interface, for the scan's candidate lists.
  - Opts are `{ now, db? }` plus the per-call extras, the same shape as Answer change. Without a handle the module opens its own transaction where it makes more than one write.
- **At most one pending Proposal per decision.** Eligibility excludes a decision holding any Proposal, for every kind. The asymmetric filters (replacement candidates not excluding a pending supersession; loose ends not excluding one) go.
- **Eligibility otherwise keeps today's rules.** Answered-by is offered on loose ends of the supersedable reasons; replacement on settled answered decisions with a later answered decision; deferral and restatement on settled own answers. A remembered dismissal matching the kind (and, for answered-by and replacement, the target) removes that candidate.
- **Accepting a replacement** sets the replacement link and reason, clears the Proposal fields and every other pending Proposal on the decision, and marks the spec not current. It writes no history row and leaves the answer, its settled time and the remembered dismissals, since the answer did not change. It does not go through Answer change.
- **The six existing actions stay** (accept and dismiss for deferral, restatement and supersession). Each keeps its refusals and codes, checks that the pending kind is its own (the existing "no pending" refusal when it is not), then calls the module. accept-supersession covers both answered-by and replacement.
- **Turn lock.** The three dismiss actions gain the 409 `turn-in-progress` refusal after every existing refusal, read the same way the accept actions read it. The new forget-dismissal action refuses the same way.
- **Schema, one migration.**
  - A Proposal kind column on decisions: `answered-by`, `replacement`, `deferral` or `restatement`, null when nothing is pending. The existing per-kind columns stay as the payload.
  - A remembered-dismissals column on decisions: a JSON list of `{ kind, targetId?, reason, dismissedAt, text? }`, where `targetId` is the named decision for answered-by and replacement and `text` is the restatement text.
  - The migration backfills the kind from the columns already set. If any decision holds more than one Proposal, the migration aborts with an error naming those decision ids, and changes nothing.
- **Remembered dismissals are part of the cleared Proposal fields.** Every Answer change already clears the cleared-Proposal set, so every answer change, a reword included, forgets the decision's dismissals with no change to Answer change's logic. The Answer change module only gains the new fields through that shared constant.
- **Storing a scan.** The scan stores all of its Proposals through `propose` in one transaction. Each decision is re-read inside the transaction; one that is no longer eligible (its answer changed, it gained a Proposal, or a matching dismissal is remembered) is skipped, not failed. The interviewer turn's own validation and retries stay as they are.
- **The deferral and restatement prompt sections** are built from eligibility, so a remembered deferral or restatement dismissal removes the decision from the keys the prompt offers. The prompt's wording does not change. A remembered answered-by or replacement is not shown to the interviewer; a repeat is skipped at store.
- **The decision's view** gains its remembered dismissals, and the decision detail sheet lists them with a Forget control that calls forget-dismissal. The cards that show pending Proposals do not change.
- **Round proposal rename.** The interviewer's round output, its validator, its turn and turn id, its retry and its type are renamed to say round proposal, with their comments. Delegation proposals and scout proposals keep their names. No column is renamed.
- **Glossary.** Dismissal, Round proposal, Delegation proposal and Scout proposal are added; Proposal gains the kinds and an _Avoid_ for the round-output sense.

## Testing Decisions

- **A good test** drives a behaviour through the highest seam that shows it and asserts on observable rows: the decision's Proposal and kind fields, its remembered dismissals, its history, other decisions' links and the spec's currency. It never asserts on which helper was called. A rule that something never happens names a planted bug, and its test must fail with that bug applied.
- **The Proposal module's interface** is the main seam: propose, accept, dismiss and forget against the in-memory database, one test per row of each ticket's behaviour table. Prior art: the Answer change module's test file, including its recording-handle test for "every write goes through the handle", since a rollback test cannot prove that on the single-connection in-memory database.
- **The actions** are tested only for what stays in them: their refusal codes, the kind check, and the turn lock after every existing refusal, each refusal pinned by its own planted-edit test. Prior art: the accept actions' "refuses … before checking the turn lock" tests.
- **The scan** is tested through the find-superseded action with the fake interviewer: one transaction, skip on a changed answer, skip on a gained Proposal, skip on a remembered dismissal. Prior art: the find-superseded test file.
- **The migration** is tested in the migrations test file: the backfill for each kind, and the abort naming the conflicting ids with nothing changed.
- **The UI** is tested by the decision detail sheet's component test and one e2e scenario: dismiss a Proposal, see it listed on the decision, forget it.
- **The rename** adds no tests: the whole suite, typecheck and lint passing is its proof.

## Out of Scope

- Renaming delegation proposals or scout proposals, or any database column.
- Showing remembered answered-by or replacement dismissals to the interviewer in its prompt.
- Collapsing the per-kind payload columns into generic Proposal columns.
- Merging the six accept and dismiss actions into one accept and one dismiss action.
- Any change to the interviewer's prompt wording, its validation rules or its retry count.
- Remembering dismissals across answer changes, or keeping them as an audit trail.
- A proposal-into-tree writer for inserting new decisions (architecture review candidate #8).

## Further Notes

- This builds on Answer change (`.grill-room/answer-change/spec.md`), which stated that marking a decision replaced "belongs to a future decision-proposal module". This spec is that module.
- Build order: the module and migration, then the scan (so every stored Proposal carries its kind before any action reads it), then the six actions, then the dismissed-Proposals UI, then the rename.
- The migration makes the first ticket's merge a one-way door: its PR body must say so, and it merges only on the owner's typed confirmation.
- The owner chose, in the grill: the stored kind column over deriving the kind; remembering dismissals per answer, matched by kind plus target, shown with a Forget control; and renaming the round proposal in this work.
