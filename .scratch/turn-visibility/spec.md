# Turn visibility

Status: ready-for-agent

## Problem Statement

I use Grill Room to run grilling interviews. Each turn is a call to a Claude model, and that call can quietly become several calls in a row. When the interviewer's proposal breaks a tree rule (it asks a question off the frontier, invents a dependency key, creates a cycle, re-asks a pushed-back question unchanged, or proposes a duplicate title), the app rejects it whole and asks again. Up to a bounded number of times, I see none of this. The turn status says "working" whether the model is on its first attempt or its third. One turn ran for 7.5 minutes with no sign of what was happening.

Refusals are not the only hidden cost. When resuming the interviewer's conversation fails, the app starts a fresh, primed conversation, which is an extra slow call I never see. When the shared subscription is rate limited, or the model returns output that fails the schema, the turn stops. But nothing records how much time went where before it stopped. This affects every kind of turn: judging readiness, proposing a round, reviewing stale decisions, checking for superseded loose ends, synthesizing the spec, and breaking the spec into tickets.

So while I wait I can't tell whether the app is stuck, the model is slow, or the interviewer keeps getting refused. Afterwards I have no evidence about what made a turn long. That means I can't decide what to optimise: fewer rejections, faster calls, or something else.

## Solution

Every model turn becomes visible while it runs and stays inspectable afterwards. How the app behaves does not change; only what it shows and records.

While a turn is running, the turn status lists each attempt it has made. Each attempt shows three things: which attempt it is out of the rejection budget ("attempt 2 of 3"), how long it took or has been running, and a one-line reason if it was refused. Each attempt is tagged with its kind: a tree-rule refusal, schema-invalid output, a resume fallback, or a rate limit. A rate limit is clearly distinguishable from an interviewer mistake.

Every turn kind gets a per-turn record holding all its attempts. The record appears collapsed next to whatever the turn produced:

- **Proposing a round:** in round history.
- **Readiness:** in the readiness panel, next to the verdict.
- **Stale review:** next to the review's what-changed digest.
- **Supersession check:** in the done panel, next to the loose ends it proposes as superseded.
- **Spec synthesis and ticket breakdown:** on the session output surface, next to the spec and the ticket list.

Every turn also records the model it ran on.

Each attempt also stores the model's raw output, so a later investigation can see exactly what was refused and why. The screen only shows the one-line reason.

When a turn stops and I press retry, the new attempts join the same turn record after a visible "manual retry" separator. The budget counter starts again at 1, and the turn's total elapsed time keeps counting. One round's history then shows the whole cost of getting that round out of the model.

## User Stories

1. As a user, I want the turn status to show each attempt the interviewer has made, so that I know the app is not stalled during a long turn.
2. As a user, I want each attempt to show its number out of the rejection budget, so that I know how close a turn is to giving up.
3. As a user, I want each attempt to show how long it took, so that I can see where the time in a turn went.
4. As a user, I want the running attempt to show a live elapsed time, so that I can tell a slow call from a stuck app.
5. As a user, I want each refused attempt to show its refusal reason in one line, so that I understand why the interviewer was asked again.
6. As a user, I want each attempt tagged with its kind, so that I can tell model mistakes apart from infrastructure delays.
7. As a user, I want tree-rule refusals labelled as refusals, so that I can see when the interviewer broke the frontier, key, cycle, push-back or duplicate-title rules.
8. As a user, I want schema-invalid output labelled as its own kind, so that I can tell malformed output apart from a rule violation.
9. As a user, I want a resume fallback shown as its own attempt, so that the extra call to start a fresh, primed conversation is no longer hidden.
10. As a user, I want a resume fallback to not count against the rejection budget, so that the counter only reflects the interviewer's refused proposals.
11. As a user, I want a rate limit shown as a rate limit, clearly distinct from an interviewer error, so that I never mistake usage exhaustion for a defect.
12. As a user, I want the attempt log to appear for round proposals, so that the turns I wait on most are never silent.
13. As a user, I want the attempt log to appear for stale reviews, so that reopening a decision never leads to a silent wait.
14. As a user, I want the attempt log to appear for spec synthesis, so that a long synthesis shows its progress.
15. As a user, I want the attempt log to appear for ticket breakdown, so that retries caused by invalid blocked-by links become visible.
16. As a user, I want attempts saved after a turn finishes, so that I can come back and see what happened.
17. As a user, I want a round's attempts to appear collapsed in round history, so that history stays readable while the detail stays available.
18. As a user, I want to expand a collapsed attempt log, so that I can inspect a particular turn when I need to.
19. As a user, I want a stale review's attempts shown next to its what-changed digest, so that I find them where I look at the review.
20. As a user, I want spec synthesis attempts shown next to the spec on the output surface, so that I find them where I look at the spec.
21. As a user, I want ticket breakdown attempts shown next to the ticket list on the output surface, so that I find them where I look at the tickets.
22. As a user, I want the same attempt log component everywhere a turn is shown, so that I learn to read it once.
23. As a user, I want the raw refused output stored with each attempt, so that a later investigation into rejections can see exactly what the interviewer proposed.
24. As a user, I want only the one-line reason shown by default, so that the raw output does not clutter the workspace.
25. As a user, I want the retry rules to stay exactly as they are, so that this change only adds visibility and the log records how the app really behaves.
26. As a user, I want only tree-rule refusals to count against the rejection budget and retry automatically, so that the counter matches the rule the app already enforces.
27. As a user, I want schema-invalid output to still stop the turn and offer a manual retry, so that behaviour doesn't change before the evidence says it should.
28. As a user, I want a rate limit to still stop the turn and offer a manual retry, so that the app doesn't burn time retrying against an exhausted usage pool.
29. As a user, I want an exhausted rejection budget to still stop the turn with an error and a retry, so that a turn with too many refusals ends visibly.
30. As a user, I want a manual retry to add its attempts to the same turn record, so that one round's full cost is in one place.
31. As a user, I want a visible "manual retry" separator in the attempt log, so that I can tell which attempts came from my retry.
32. As a user, I want the budget counter to start again at 1 after a manual retry, so that "attempt N of the budget" never reads like "attempt 5 of 3".
33. As a user, I want the turn's total elapsed time to keep counting across manual retries, so that I see the real time I waited for a round.
34. As a user, I want the live attempt status to survive navigation and reload, so that I can leave a running turn and come back to its progress.
35. As a user, I want the attempt log to update live as attempts start and finish, so that I never have to reload to see progress.
36. As a user, I want the rest of the workspace to stay usable while the attempt log updates, so that visibility doesn't block my work.
37. As a user, I want turns from before this change to show no attempt log rather than a made-up one, so that everything in the log is real.
38. As a user, I want a turn that succeeds first time to show a single attempt, so that clean turns are visibly clean.
39. As a user, I want the attempt log of a failed turn kept even when I don't retry, so that failures are still evidence.
40. As a user, I want the attempt log to record which attempt finally succeeded, so that I can see how many tries a result took.
41. As a user, I want attempt data kept in the local database, so that the evidence stays on my machine like the rest of my data.
42. As a user improving Grill Room, I want the saved attempts to show which rejection reasons come up most, so that a later session on cutting rejections works from evidence rather than hunches.
43. As a user improving Grill Room, I want to compare time spent on refusals, resume fallbacks and rate limits, so that I can decide whether to cut rejections, speed up calls, or do something else.
44. As a user improving Grill Room, I want the log to show how often turns run long, so that I can later decide whether cancelling a turn is worth building.
45. As a user, I want the attempt log to appear for readiness judgments, so that judging an idea is never a silent wait.
46. As a user, I want the attempt log to appear for the supersession check, so that a refused supersession proposal is visible.
47. As a user improving Grill Room, I want every turn to record the model it ran on, so that turn cost and refusals can be compared across models.
48. As a user improving Grill Room, I want new kinds of turn to get a turn record without a schema change, so that turns added later are visible from the start.

## Implementation Decisions

### Scope

- This change is purely about visibility. Retry rules, budgets and turn outcomes do not change.
- The baseline is the existing Grill Room design, plus the follow-ups already shipped: rationales on every choice with a marked recommended index, superseded loose ends proposed in the done panel, a what-changed digest after a stale review, grill-with-docs, batch reopens, the nudge toward whole-round mode, set-aside decisions that cannot supersede, history that keeps the question as asked, the outline as the only tree layout, and rejection of duplicate titles.

### Turn record

- A new per-turn record is introduced for every model turn. Six turn kinds run through the retry loop (`askUntilAccepted`) today: assess readiness, propose round, stale review, supersession check, spec synthesis and ticket breakdown.
- Turn kind is an open list, not a closed enum in the schema: a new request kind gets turn records by naming its kind, with no migration. Project scouts are the next kinds planned.
- A readiness judgment, a round, a stale review, a supersession check, a spec synthesis run and a ticket breakdown run each point at their turn record. Attempts do not live on the round itself, so turns that produce no round share the same structure.
- A turn record holds:
  - its turn kind
  - the model it ran on
  - its start time and total elapsed time
  - its final outcome (succeeded, or stopped with the kind of failure)
  - an ordered list of attempts, grouped into runs

### Relation to the session's turn state

- The session row keeps its turn fields (`turnStatus`, `turnErrorCode`, `turnErrorMessage`, `turnStartedAt`) unchanged. They remain the turn lock and the current status the workspace reads.
- The turn record sits beside them as the history of every turn. It does not replace the lock, and nothing that reads the session's turn fields changes.

### Runs and attempts

- A run is one pass through the app's retry loop. The first run starts with the turn. Each manual retry starts a new run on the same turn record.
- The budget counter is per run: it starts again at 1 each run, and matches the rejection budget the app enforces.
- Total elapsed time is per turn and keeps counting across runs.
- Each attempt records:
  - its position within its run
  - its start time and duration
  - its kind: tree-rule refusal, schema-invalid output, resume fallback, rate limit, or success
  - a one-line reason for anything that is not a success
  - the raw model output, where there is one
- The one-line reason for a tree-rule refusal is the same reason already sent back to the interviewer when its proposal is rejected. It names the rule that was broken: off-frontier question, unknown key, cycle, unchanged re-ask after a push back, or duplicate title.

### Budget and retry semantics (unchanged, now labelled)

- Only tree-rule refusals count against the rejection budget and trigger automatic retries.
- A resume fallback is logged as its own attempt and does not count against the budget.
- Schema-invalid output stops the turn and offers the existing manual retry.
- A rate limit stops the turn and offers a manual retry. Its error is reported distinctly from an interviewer error.
- An exhausted rejection budget stops the turn with the existing error and retry.
- A turn that stops keeps its turn record and attempts, whether or not the user retries.

### Interviewer port and turn orchestration

- The code that runs a turn creates the turn record when the turn starts. It appends an attempt when each model call starts, and completes that attempt when the call returns or fails.
- The port reports a resume fallback, a rate limit and schema-invalid output as distinguishable outcomes, so the orchestration can tag each attempt correctly.
- Attempts are written to the database as they happen, not at the end of the turn. This lets the live status survive navigation and reload through the framework's database sync.

### Interface

- A single attempt log component is used everywhere a turn is shown.
  - While a turn runs, it shows each attempt as one line: attempt N of the budget, elapsed time, and the one-line reason when there is one.
  - After the turn it renders collapsed and can be expanded.
- Manual-retry runs are marked by a visible "manual retry" separator.
- The component appears:
  - **Round proposals:** in the live turn status and collapsed in round history.
  - **Readiness:** in the live turn status and collapsed in the readiness panel.
  - **Stale reviews:** in the live turn status and collapsed next to the what-changed digest.
  - **Supersession check:** in the live turn status and collapsed in the done panel.
  - **Spec synthesis and ticket breakdown:** on the session output surface, next to the spec and the ticket list.
- Raw output is stored but not shown by default.

### Schema

- The schema gains turn, run and attempt data, added through additive migrations only.
- Existing rounds, stale reviews and spec or ticket runs get no turn record. Nothing is backfilled, and the interface shows no attempt log for them.

## Testing Decisions

- Good tests assert on externally observable behaviour: given a sequence of action calls and a scripted interviewer, what do later action calls return about the turn, its runs and its attempts. Tests never assert on internal function calls or table layouts.
- Behaviour is tested at the action boundary against a real in-memory instance of the embedded database, with the scripted fake interviewer. This follows the approach and placement already used across the project's action tests.
- The fake interviewer's scripts are extended to produce, in sequence:
  - a clean success
  - one or more tree-rule refusals followed by a success
  - refusals that exhaust the budget
  - schema-invalid output
  - a resume fallback
  - a rate limit
- Cases to cover:
  - A clean turn records exactly one successful attempt.
  - Refusals record one attempt each, with the matching kind and reason, and count up against the budget.
  - An exhausted budget stops the turn and keeps all its attempts.
  - A resume fallback is recorded as its own attempt and does not use up budget.
  - Schema-invalid output and rate limits stop the turn, with their own kinds, and rate limits are distinct from interviewer errors.
  - A manual retry adds a new run to the same turn record, the budget counter starts again at 1, and total elapsed time keeps counting across runs.
  - Raw output is stored for each attempt that produced output.
  - Readiness judgments, stale reviews, supersession checks, spec synthesis and ticket breakdown each produce a turn record linked to what they produced.
  - Every turn record carries the model the turn ran on.
  - A turn kind the schema has never seen is stored and read back without a migration.
  - The session's turn fields behave exactly as before, confirmed by the existing tests still passing.
  - Rounds and other results created before this change have no turn record.
  - Retry behaviour is unchanged from before, confirmed by the existing tests still passing.
- The contract test on the real adapter is extended to assert that a failed resume, a rate limit and schema-invalid output each come back as distinguishable outcomes.
- The browser smoke test is extended with the fake interviewer scripted to refuse once and then succeed. It checks that the live status shows two attempts and that round history shows the collapsed log.
- Each ticket's verification is the project's test command plus its type check.

## Out of Scope

- Changing any retry behaviour: automatic retry of schema-invalid output, merging budgets, or retrying on rate limits.
- Cutting rejections through prompt, schema or repair changes. That is a later session, driven by what the attempt log records.
- Making individual calls faster: smaller rounds, different default models, or streaming.
- Letting the user keep working on the tree while a turn runs, beyond what already works.
- Cancelling a running turn. This is deferred until the attempt log shows how often long turns happen.
- Showing raw refused output in the interface by default.
- A single session-wide turn log detached from what each turn produced.
- Backfilling turn records for turns that ran before this change.
- Fixing the stale ticket statuses in previously exported tickets, or syncing ticket status from build records. That belongs to the output-loop area.

## Further Notes

- Grilled in Grill Room by a second user on Grill Room itself (issue #11 on `jisequilla/grill-room`), then checked against the code: the retry semantics held; the turn kinds, the relation to the session's turn state and the model per turn were corrected.

- This change is the first step of improving turn latency and flow. It exists to produce evidence. What to do next — cut rejections, speed up calls, or build a cancel path — should be decided in a later session from the attempt data this change collects.
- The app, the agents building it, and the orchestrating session all share one Claude subscription usage pool. Keeping rate-limit attempts separate from model mistakes is what stops usage exhaustion from being read as a defect, or from skewing the rejection evidence.
- The raw outputs stored with attempts are for the later rejection investigation. On a local, single-user embedded database their size is acceptable.
