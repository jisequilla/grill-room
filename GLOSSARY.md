# Grill Room

A local, single-user grilling app: an interviewer turns a loose idea into a tree of settled decisions, then a spec and a handoff bundle.

## Decisions

**Answer change**:
Any write that gives a decision a new answer state: settling, deferring, rewording, unsettling or withdrawing it. The prior answer goes to the decision's history, and the decision's proposals and the claims naming it lapse.
_Avoid_: answer update, decision transition

**Proposal**:
A pending suggestion about a decision's own answer that the owner accepts or dismisses. Its kind is one of: answered-by (a later decision answers this loose end), replacement (a later decision replaces this settled one), deferral, or restatement. A decision holds at most one.
_Avoid_: suggestion; "proposal" for the interviewer's round output (say round proposal)

**Dismissal**:
A Proposal the owner turned down, remembered for as long as the decision's answer stands, so it is not offered again. A deferral or restatement is remembered by kind; an answered-by or replacement also by the decision it named. Any answer change forgets them.

**Round proposal**:
What an interviewer turn returns for a round: new decisions, push-back responses, placements of user-added decisions, and whether the tree is done.

**Delegation proposal**:
A project's delegation value read from the repository and not yet confirmed by the owner.

**Scout proposal**:
A repo decision the scout proposes from a registered project's codebase, which the owner keeps or drops.

**Claim**:
Another decision's link to this decision's answer: a pending supersession by this decision, or a record of having been replaced by it. A claim rests on the answer as it stood, so it lapses when that answer changes. A reword lapses only the pending supersessions, which may quote the old wording.

**Reword**:
An answer change that keeps the answer's meaning and kind and changes only its wording, as when a restatement is accepted. Its proposals lapse; its own links, and the records of what it replaced, stay.
_Avoid_: edit
