# 05 Turn the session header model label into a select until locked

Status: ready-for-agent
Blocked by: 03, 04

In the session header, where the model is already displayed, render a select over the supported models when the payload's locked flag is false, and the existing static text when it is true. Disable the select while a turn is working (the flag covers this). On change, call the set-session-model action. On a typed locked error, show an inline message naming the model the session is fixed on and refresh the session state so the header drops the select. The create form and default-model setting are untouched.

Judged by: manual verification that a fresh session shows the select, a change takes effect, a session with a conversation id shows static text, and a stale tab submitting after lock shows the inline message and refreshes. No browser test is required per the spec.