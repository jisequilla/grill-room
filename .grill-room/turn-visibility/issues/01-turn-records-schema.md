# 01 Add turn, run and attempt records to the schema

Status: ready-for-agent
Blocked by: none
Suggested model: sonnet

## What to build

Add the data model for turn visibility using additive migrations only.

- **Turn record**: the turn kind, the model it ran on, its start time, its total elapsed time, and its final outcome (succeeded, or stopped with the kind of failure).
- **Turn kind is an open list**: store it as text, not a closed enum. The six kinds today are assess readiness, propose round, stale review, supersession check, spec synthesis and ticket breakdown; new request kinds (project scouts are next) must need no migration.
- **The session's turn fields stay as they are**: `turnStatus`, `turnErrorCode`, `turnErrorMessage` and `turnStartedAt` on the session remain the turn lock and current status. The turn record sits beside them as history and replaces nothing.
- **Run**: one pass through the retry loop, belonging to a turn. Runs are ordered, and a run after the first is marked as a manual retry.
- **Attempt**: belongs to a run. Holds:
  - its position within the run
  - its start time and duration
  - its kind: tree-rule refusal, schema-invalid output, resume fallback, rate limit, or success
  - a one-line reason when it is not a success
  - the raw model output, where there is one
- A readiness judgment, a round, a stale review, a supersession check, a spec synthesis run and a ticket breakdown run can each point at a turn record. The link is optional, so existing data has none and nothing is backfilled.
- Add actions that let the server create and complete turns, runs and attempts, and a read action that returns a turn with its runs and attempts in order.

## How it will be judged

- Action tests against the in-memory embedded database cover:
  - Creating a turn, adding runs and attempts, and completing them, then reading the turn back with runs and attempts in order and every field intact, including raw output.
  - Existing rounds and other results with no turn record read back without an attempt log.
  - A turn with a kind not among the six is stored and read back intact.
  - The model is stored and read back on every turn.
- Migrations are additive only.
- Verification: the project's test command plus its type check.
