# 02 Ensure the turn launch path reads the model from the session row

Status: ready-for-agent
Blocked by: none

Confirm that the start-turn path reads the session's model from the row at the moment it launches the CLI adapter. If the model is captured anywhere else at creation time (a per-session config object, a job payload, a cached session object), remove that copy so the row is the only place the model lives. Do not add a second write to keep a copy in sync.

Also extend the fake interviewer, if it does not already, to record the model it was invoked with on each turn.

Judged by: an action-level test that changes the session's model field directly on a fresh session, runs a turn through the fake interviewer, and asserts the fake reports the new model. Existing turn tests still pass.