# Retrospective: the first real session

The first interview a user ran in Grill Room end to end, on a real idea ("Agent Observability"), with Fable as interviewer in one-at-a-time mode.

## The session in numbers

| | |
|---|---|
| Decisions in the tree | 72 (62 before the reopens, 10 added by reviews and the user) |
| Rounds submitted | 96, carrying 101 cards |
| Recommendation accepted | 72 cards |
| Own answer | 16 |
| Steering moves | 7 deferred, 3 unknown, 2 prototype-flagged, 1 pushed back (withdrawn by the interviewer with a reason) |
| Reopened after the comparison | 7 decisions, each with a real stale review |
| Settled before and after the reopens | 49, then 34: fifteen downstream decisions became open again |
| Real interviewer turns for the reopens | 29 s to 48 s each |

## What worked

**The design tree did the thing chat cannot.** Reopening `dashboard-access` made seven dependents stale; the review reconfirmed four with a reason each and re-asked the three that the new answer broke (host identity, tailnet scope, the milestone acceptance test that assumed a second machine). Reopening five foundations turned fifteen settled decisions into open questions, every one of them a real consequence.

**The steering moves were used as designed.** The push back was withdrawn with a coherent reason. "I don't know" and prototype flags became loose ends that the done gate refused to skip.

**Every detail was reachable from outside.** The main session read the idea, all answers and the open round through the app's actions, exported the decisions as data for a comparison, and drove the reopens through the same actions the UI uses.

**The comparison against the existing system was worth more than the interview.** Of 49 settled decisions, 19 had no counterpart in the existing product, six of them real defects in a shipped system, and the four hardest-won lessons of that system (subagent lineage, cache-token TTL pricing, the five-hour subscription window, payload limits) never appeared in 96 rounds.

## What did not

1. **The user could not judge the alternatives.** Across 72 decisions the recommendation carried a median 146 characters of reasoning; each other choice was a 29-character label. In the user's words: "the non recommended options should have more detail, only the recommended has enough info to decide if it is ok or not". The port schema is the cause: choices are bare strings. The same separation is why the UI had to guess which chip was the recommendation and misrecorded accepted recommendations as own answers.
2. **Loose ends that later decisions answered stayed open.** Three of five loose ends at done-proposed had been answered by other settled decisions, and still blocked confirmation.
3. **The interviewer never asked whether the system already existed.** By design (no fact-finding in v1), and this session showed the price.
4. **A reopen hands the consequences to the interviewer, not the user.** After seven reopens, fifteen re-asked cards arrived with no digest of why; the reasons exist, but only inside each decision's history.
5. **Two operations had no UI:** the comparison, and bulk reopens with pre-approved answers. Both were done over HTTP by the orchestrating session.
6. **Ninety-six one-card rounds.** Upstream expects a handful of rounds of many questions. A valid choice, but the app never suggested otherwise, and at one to two minutes per turn it made the session long.

## Improvements filed

| Bead | Improvement | Why first |
|---|---|---|
| gr-28 (P0) | Choices carry a rationale; the interviewer marks the recommended one explicitly | Fixes the user's main complaint and the accept-recording bug at their shared root |
| gr-29 | Superseded loose ends: detect and resolve in one click | Three of five loose ends were already answered |
| gr-30 | What-changed digest after a stale review | The main navigation problem after reopens |
| gr-31 | Grill-with-docs mode: a read-only folder the interviewer may read | The interview designed something that already existed |
| gr-32 | Bulk reopen from a comparison document | What the orchestrator scripted today, as a feature |
| gr-33 | Round-size nudge after many one-at-a-time rounds | Ninety-six rounds |

## For the PoC

Two findings belong in the write-up. First, the tool worked as a container for the method, including the part the method cannot do in chat. Second, the method's own limits showed clearly: grill-me without fact-finding will happily interview you about a system you already built, and the interviewer's asymmetry between the recommendation and the alternatives quietly steers the user toward accepting (72 of 101 cards).
