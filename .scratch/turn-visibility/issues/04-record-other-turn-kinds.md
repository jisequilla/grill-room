# 04 Record attempts for readiness, stale review, supersession, spec synthesis and ticket breakdown turns

Status: ready-for-agent
Blocked by: 03
Suggested model: sonnet

## What to build

Apply the attempt recording from ticket 3 to the other five turn kinds, every other caller of `askUntilAccepted`:

- **Readiness** (`actions/assess-readiness.ts`): link the turn record to the stored readiness judgment.
- **Supersession check** (`server/supersession.ts`): link the turn record to the check whose superseded loose ends the done panel proposes.

- **Stale review**: link the turn record to the review that ends with the what-changed digest.
- **Spec synthesis**: link the turn record to the spec it produced.
- **Ticket breakdown**: link the turn record to the tickets it produced. Invalid blocked-by links (unknown ticket or a cycle) that are refused and retried are logged as tree-rule refusals, with the existing rejection reason.

Each turn records all failure kinds as in ticket 3. Retry behaviour stays exactly as it is.

## How it will be judged

- Action tests with the scripted fake interviewer check that:
  - Readiness, stale review, supersession check, spec synthesis and ticket breakdown each produce a turn record linked to their result, with a single attempt on a clean run and the model recorded.
  - No caller of `askUntilAccepted` is left without a turn record (`grep -rl askUntilAccepted actions server` lists exactly the callers covered by tickets 03 and 04).
  - A ticket breakdown with a cyclic blocked-by proposal followed by a valid one records a refusal and then a success.
  - A stale review that hits a rate limit stops with a rate-limit attempt and keeps its record.
- Existing tests still pass.
- Verification: the project's test command plus its type check.
