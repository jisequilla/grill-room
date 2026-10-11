# Grill Room

A local, single-user grilling app: an interviewer turns a loose idea into a tree of settled decisions, then a spec and a handoff bundle.

## Decisions

**Answer change**:
Any write that gives a decision a new answer state: settling, deferring, rewording, unsettling or withdrawing it. The prior answer goes to the decision's history, and the decision's proposals and the claims naming it lapse.
_Avoid_: answer update, decision transition

**Proposal**:
A pending suggestion about a decision's own answer (a supersession, a deferral or a restatement) that the owner accepts or dismisses.
_Avoid_: suggestion

**Claim**:
Another decision's link to this decision's answer: a pending supersession by this decision, or a record of having been replaced by it. A claim rests on the answer as it stood, so it lapses when that answer changes. A reword lapses only the pending supersessions, which may quote the old wording.

**Reword**:
An answer change that keeps the answer's meaning and kind and changes only its wording, as when a restatement is accepted. Its proposals lapse; its own links, and the records of what it replaced, stay.
_Avoid_: edit
