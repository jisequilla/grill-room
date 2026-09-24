# 03 Record every attempt of a propose-round turn

Status: ready-for-agent
Blocked by: 01, 02
Suggested model: opus

## What to build

When a propose-round turn starts, create a turn record with its first run. For each model call:

- Add an attempt as soon as the call starts.
- Complete the attempt when the call returns or fails, recording its kind, duration, one-line reason and raw output.

Tagging rules:

- **Tree-rule refusals**: the reason is the same rejection reason that is already sent back to the interviewer.
- **Resume fallback**: its own attempt, and it doesn't count against the rejection budget.

Finishing the turn:

- Record the model the turn runs on when the turn record is created (the session's interviewer model).
- On success, link the resulting round to the turn and record which attempt succeeded.
- When the turn stops (exhausted budget, schema-invalid output or rate limit), record the outcome and keep all its attempts.

Put the recording logic somewhere the other turn kinds can reuse it. Retry behaviour stays exactly as it is:

- Only tree-rule refusals count against the budget and retry automatically.
- Schema-invalid output and rate limits stop the turn.

## How it will be judged

- Action tests use the scripted fake interviewer and the in-memory database, and check that:
  - A clean turn has exactly one successful attempt.
  - Refusals followed by a success record one attempt each, with the right kind and reason, numbered upward within the run.
  - An exhausted budget stops the turn and keeps every attempt.
  - A resume fallback is its own attempt and doesn't use up budget.
  - Schema-invalid output and rate limits stop the turn with their own kinds, and a rate limit is distinct from an interviewer error.
  - Raw output is stored for every attempt that produced output.
  - Attempts can be read back while the turn is still running.
- All existing tests still pass, which shows retry behaviour is unchanged.
- Verification: the project's test command plus its type check.
