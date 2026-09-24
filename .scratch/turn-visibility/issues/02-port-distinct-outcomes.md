# 02 Make the interviewer port report resume fallback, rate limit and schema-invalid output as distinct outcomes

Status: ready-for-agent
Blocked by: none
Suggested model: opus

## What to build

Today the orchestration can't tag each model call correctly because the port doesn't tell these outcomes apart. Change the interviewer port so that every model call reports one of these outcomes, and never silently merges one into another:

- **Success**, with the raw output.
- **Schema-invalid output**, with the raw output and a one-line reason.
- **Rate limit**, with a one-line reason. It must be distinct from an interviewer error.
- **Resume fallback**: resuming the conversation failed and a fresh, primed conversation was started. Report this as a separate call, so the extra call can be logged as its own attempt.

The port also needs a way to tell its caller when each call starts and ends, so the caller can record attempts as they happen and not only at the end of the turn.

Extend the scripted fake interviewer so scripts can produce, in sequence:

- a clean success
- tree-rule-violating proposals (off-frontier question, unknown key, cycle, unchanged re-ask, duplicate title)
- schema-invalid output
- a resume fallback
- a rate limit

Don't change retry behaviour.

## How it will be judged

- The contract test on the real adapter, with the process spawn stubbed, asserts that:
  - a failed resume, a rate-limited run and schema-invalid output each come back as distinguishable outcomes;
  - the existing assertions still hold: tools disabled, the session's model, the resume id, the output schema, and the nested-session marker cleared.
- The fake interviewer can script every outcome listed above.
- Existing tests pass unchanged.
- Verification: the project's test command plus its type check.
