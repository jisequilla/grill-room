# 05 Make a manual retry continue the same turn record as a new run

Status: ready-for-agent
Blocked by: 03
Suggested model: sonnet

## What to build

When a turn has stopped and the user presses the existing retry, add a new run to the same turn record instead of creating a new turn. This applies to every turn kind.

- The new run is marked as a manual retry.
- Its attempt numbering, and so the budget counter, starts again at 1.
- The turn's total elapsed time keeps counting across runs.
- If the retry succeeds, the resulting round, review, spec or tickets link to that same turn record.

## How it will be judged

Action tests with the scripted fake interviewer check that:

- For a turn stopped by schema-invalid output, a rate limit or an exhausted budget, a manual retry adds a second run to the same turn.
- The second run's first attempt is numbered 1, and the run is marked as a manual retry.
- Total elapsed time covers both runs.
- A successful retry links its result to the original turn.
- A turn that stops and is never retried keeps its single run.

Verification: the project's test command plus its type check.
