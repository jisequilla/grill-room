# Grill Sessions Through the App

A request to grill an idea "in the Grill Room app", or to produce a bundle for a registered project, runs through the app's HTTP actions with the `drive-grill-room` skill. Load it before the first call: it holds the action sequence, the body each action takes, and the errors earlier runs hit.

- The owner answers every card of a real session, through AskUserQuestion. Only a fake-interviewer session is answered without asking.
- Subagents run their own fake-interviewer server on a free port with an isolated database, never the owner's server on 8082.
- `/grill-me` in a conversation stays the way to grill without the app, as `CLAUDE.md` describes.
