# 03 Add the dedicated set-session-model action with lock enforcement

Status: ready-for-agent
Blocked by: 01, 02

Build a single-purpose action taking a session id and a model. Within one transaction it reads the session row, validates the model against the shared session constants, refuses with a typed locked error carrying the recorded model if the shared helper reports the session locked, and otherwise overwrites the model field. Selecting the already-recorded model succeeds as a no-op. Nothing is logged or historied. No general update-session action is introduced.

Judged by action-level tests with the fake interviewer: fresh session accepts the change, the row reflects it, and the next fake turn reports the new model; a session whose fake first turn set a conversation id refuses with the typed locked error and the row is unchanged; a session with turn status working refuses likewise; a session whose turn failed without a conversation id still accepts; a model outside the constants is rejected and the row is unchanged; the model can be changed more than once before lock.