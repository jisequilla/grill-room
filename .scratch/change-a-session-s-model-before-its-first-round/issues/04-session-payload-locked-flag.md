# 04 Expose a derived modelLocked flag on the session payload

Status: ready-for-agent
Blocked by: 01

When building the session payload sent to the interface, call the shared helper to populate a derived boolean locked flag. The flag is computed, not stored; the sessions schema is unchanged.

Judged by: tests asserting the flag is false for a fresh session and for a failed turn with no conversation id, and true once a conversation id exists or a turn is working.