# Change a session's model before its first round

Status: ready-for-agent

## Problem Statement

When I create a Grill Room session I pick the interviewer model (fable, opus or sonnet) on the create form, and the app records it so that interview quality can later be compared across models. Once the session exists, nothing can change that model. If I picked the wrong one, or change my mind before I have actually started interviewing, my only option is to delete the session and create it again. That is needless friction for a mistake made before any interviewing happened.

At the same time, the recorded model has to stay trustworthy. The whole point of recording it is that every round of a session ran on the model the session says it ran on. Any change mechanism that lets the model drift after the interviewer conversation exists would silently corrupt that comparison.

## Solution

Let me change a session's interviewer model after creating it, right where the model is already displayed in the session header, for as long as the session has not yet started an interviewer conversation. The moment the interviewer conversation exists, or a turn is in flight, the model is locked for good and the control becomes the same static text it is today.

The lock is enforced by the action that performs the change, not merely by hiding the control, so a stale tab or a racing request cannot flip the model after the first round. The interface simply reflects the same rule the action applies, using one shared definition of "locked". Because no interview ever ran on a pre-lock model, the change is not recorded anywhere; the session's model field is simply overwritten.

## User Stories

1. As a session creator, I want to change a session's interviewer model after creating it, so that a wrong pick does not force me to delete and recreate the session.
2. As a session creator, I want the model change control to sit exactly where the session already shows its model, so that I find it without hunting.
3. As a session creator, I want the model label in the session header to be a select before the first round, so that changing the model is a single interaction.
4. As a session creator, I want the select to offer exactly the models the app supports (fable, opus, sonnet), so that I cannot choose an invalid model.
5. As a session creator, I want the model to lock once the interviewer conversation exists, so that every round of the session ran on the model the session records.
6. As a session creator, I want the locked model to render as the same static text it rendered as before this feature, so that the lock reads as a natural transition rather than a missing control.
7. As a session creator, I want the model to remain changeable after a turn that failed before creating an interviewer conversation, so that a transient failure does not cost me the session.
8. As a session creator, I want the model to lock after a turn that created an interviewer conversation, even if that turn then failed, so that a resumed conversation never runs on a different model than recorded.
9. As a session creator, I want the model change to be refused while a turn is working, so that a running first turn is never pulled out from under its model.
10. As a session creator, I want the control disabled in the header while a turn is working, so that I am not offered an action that would be refused.
11. As a session creator, I want the next turn after a successful model change to run on the new model, so that the change actually takes effect.
12. As a session creator, I want a refused change to show a clear inline message naming the model the session is fixed on, so that I understand what happened.
13. As a session creator, I want the header to refresh to the locked state after a refused change, so that a stale page stops offering the control.
14. As a session creator, I want the change to be refused by the server even if a stale tab still shows the select, so that the recorded model cannot be corrupted by an out-of-date page.
15. As a session creator, I want the change to be refused by the server regardless of which client called it, so that the guarantee does not depend on the interface.
16. As a session creator, I want a refused change to leave the session's model untouched, so that a refusal never partially applies.
17. As a session creator, I want the session's recorded model to be the only model that ever ran a round of that session, so that cross-model comparisons stay honest.
18. As a researcher comparing interview quality across models, I want a session's model field to be reliable, so that I can group sessions by model without a second source of truth.
19. As a researcher comparing interview quality across models, I want no history of pre-lock model values, so that I am not misled by values that never produced any interview output.
20. As a session creator, I want the pre-lock value to be simply overwritten, so that the schema and my mental model of the session stay unchanged.
21. As a session creator, I want the default-model setting to keep affecting only new sessions, so that changing a default never silently alters an existing session.
22. As a session creator, I want the create form to keep letting me pick the model up front, so that the common case is unchanged.
23. As a developer, I want the lock rule defined in exactly one place, so that the action and the interface can never disagree about whether a session is locked.
24. As a developer, I want the session payload to carry a derived locked flag, so that the header does not reimplement the lock rule.
25. As a developer, I want the model change to be its own dedicated action, so that the lock check sits next to the only field it guards.
26. As a developer, I want the action to read the session row and write the change within the same transaction, so that a concurrent turn start cannot slip between the check and the write.
27. As a developer, I want the action to validate the requested model against the shared session constants, so that an unsupported model is never stored.
28. As a developer, I want a typed locked error from the action, so that the interface and the tests can distinguish "locked" from any other failure.
29. As a developer, I want the turn launch path to read the model fresh from the session row, so that a change made before the first turn is what the adapter receives.
30. As a developer, I want no second copy of the model held anywhere outside the session row, so that the action never needs to double-write.
31. As a developer, I want action-level tests with the fake interviewer to prove the lock, so that the guarantee is tested where it lives.
32. As a developer, I want the fake interviewer to record the model it was invoked with, so that a test can assert the changed model reached the adapter.
33. As a session creator, I want changing the model on a fresh session to succeed immediately, so that correcting a wrong pick is painless.
34. As a session creator, I want to be able to change the model more than once before the first round, so that I am not locked in by my first correction.
35. As a session creator, I want selecting the model already recorded to be harmless, so that a no-op choice never errors.

## Implementation Decisions

**Lock definition.** A session's model is locked when either of two facts holds on the session row: an interviewer conversation id exists, or the turn status is working. The conversation id is the artifact the CLI adapter resumes, so its existence is the exact moment a different model would corrupt the record. A failed turn that never set a conversation id leaves the model changeable; a failed turn that did set one locks it. The working state is treated as locked so a first turn in flight cannot have its model changed underneath it. Round rows and their submission state play no part in the rule.

**Single source of the rule.** One shared helper computes the lock from the session row. The model-change action calls it, and the session payload builder calls it to populate a derived boolean locked flag. The header reads that flag and never reconstructs the rule from conversation id or turn status.

**Dedicated action.** A single-purpose set-session-model action takes a session id and a model. It reads the session row and performs the update within one transaction; validates the model against the shared session constants; refuses if the shared helper reports the session locked; otherwise overwrites the model field. No general update-session patch action is introduced.

**Refusal contract.** A refused change returns a typed locked error that carries the model the session is fixed on. The interface renders it inline and refreshes the session state so the header drops the select. A silent no-op or a generic thrown error is not used.

**No recording of the change.** The previous model value is not logged, historied or stored. Because no interview ever ran on it, it carries no comparison signal. The sessions schema is unchanged apart from the derived locked flag on the payload, which is computed, not stored.

**Turn launch reads the row.** The start-turn path reads the model from the session row at the moment it launches the CLI adapter. If any copy of the model is currently captured elsewhere at creation time (a per-session config object, a job payload, a cached session object), that copy is removed rather than kept in sync by a second write.

**Interface placement.** The control lives inline in the session header where the model is already displayed. Before lock the label is a select over the supported models; after lock it is the same static text the session already renders. While a turn is working the control is disabled. The create form continues to offer the initial model choice, and the default-model setting continues to affect only new sessions.

## Testing Decisions

A good test exercises the action boundary and observes only external behaviour: the returned result or typed error, the session's model field afterwards, and the model the fake interviewer reports it was invoked with. Tests do not inspect how the lock helper or the header is implemented.

Tests live at the action level using the fake interviewer, following the existing pattern of action tests that drive turns through the fake. The fake interviewer is extended, if it does not already do so, to record the model it received on each invocation.

Cases:

- A fresh session with no conversation id and idle turn status accepts a model change; the row reflects the new model; the next turn run through the fake interviewer reports the new model.
- A session whose first fake turn has set a conversation id refuses a model change with the typed locked error carrying the recorded model; the row is unchanged.
- A session whose turn status is working refuses a model change with the typed locked error; the row is unchanged.
- A session whose turn failed without setting a conversation id still accepts a model change.
- A request naming a model outside the shared constants is rejected and leaves the row unchanged.
- The session payload's locked flag is false for a fresh session and true once a conversation id exists or a turn is working.

No browser or interface test is written for the disabled or hidden control; the action guarantees the invariant and the flag test covers what the header consumes.

## Out of Scope

- Choosing different models for interviewing, spec synthesis and ticket breakdown within one session, as the spec already lists.
- Changing a session's model after the interviewer conversation exists, under any circumstances.
- Recording, logging or displaying any history of model values a session held before its lock.
- A general update-session action for other per-session edits such as renaming.
- Any change to how the default-model setting behaves.
- Interface tests for the model control.

## Further Notes

The lock keys on the interviewer conversation rather than on round rows because the conversation is what would be resumed on the wrong model. This means a session can be locked with zero rounds stored, which is correct: the recorded model is the one that produced the conversation, whatever became of the round.

The turn-launch path reading the model fresh from the row is a prerequisite for the feature to mean anything. If the model turns out to be captured elsewhere at creation, removing that copy is part of this work, not a follow-up.