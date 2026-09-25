# 01 Add a shared helper that decides whether a session's model is locked

Status: ready-for-agent
Blocked by: none

Build a single pure helper that takes a session row and returns whether its interviewer model is locked. The rule: locked when a conversation id exists, or when turn status is working. Round rows and submission state play no part. Nothing else in the codebase may reimplement this rule.

Judged by: unit tests for the helper covering fresh session (unlocked), failed turn without conversation id (unlocked), conversation id present with any turn status (locked), turn status working without conversation id (locked).