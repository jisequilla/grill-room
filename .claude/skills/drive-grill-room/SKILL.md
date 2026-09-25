---
name: drive-grill-room
description: Run a Grill Room session end to end through the app's HTTP actions, from a loose idea to an exported bundle (spec, decisions, tickets, HANDOFF.md, grounded briefs). Use when asked to grill an idea "in the Grill Room app", to produce or regenerate a bundle for this repo or another registered project, or to exercise the app's pipeline on a real or fake interviewer.
---

# Driving a Grill Room session

The app's UI and an agent use the same actions: `POST /_agent-native/actions/<name>` with a JSON body, and `GET` with query parameters for reads. `scripts/grill.py` wraps both, plus the save-and-submit loop for a round. Every step below was run on real sessions; the error table records what went wrong before.

## Which server

| Who is driving | Server | Interviewer |
|---|---|---|
| The main session, on the owner's behalf | The owner's server, `http://localhost:8082` | Real Claude CLI |
| A subagent, or any test of the pipeline | Its own server, started and stopped by it | Fake (`GRILL_ROOM_INTERVIEWER=fake`) |

A subagent never uses port 8082 or the owner's database. From `grill-room/`, start an isolated server directly: `just dev-fake` refuses while the owner's server runs, because it guards the shared database.

```bash
GRILL_ROOM_INTERVIEWER=fake AUTH_DISABLED=true DATABASE_URL="pglite:$SCRATCH/grill-db" \
  pnpm exec agent-native dev --port <free port> --strictPort
```

`run_in_background` gives a task id, not a process id. Once the server log says it is ready, find its PID with `lsof -iTCP:<port> -sTCP:LISTEN`, record it, and stop only that PID. Point the script at the server with `GRILL_ROOM_URL=http://localhost:<port>`.

### What the fake interviewer can and cannot test

On the fake interviewer, call `use-fake-scenario {sessionId, scenario}` right after `create-session` and before anything that asks for a turn. The list is `fakeScenarios` in `server/interviewer/fake.ts`. A scenario is a fixed queue of replies, so it tests the plumbing (state changes, the export), never the content:

- **It ignores your idea.** `demo` replays one real interview about the `decisions.md` export. Whatever idea you submit, the spec, tickets and briefs describe that feature.
- **`demo` only lines up against this repository.** Its scout replies cite this repo's files. On any other project the citations fail the scout check, and the queue falls out of step.
- **A refused reply still uses up its queue entry.** After one `500` whose server log says `next scripted turn ... is "X" but the request was "Y"`, the rest of that session is out of step. Start a new session; do not call again to skip ahead.
- **Scenarios do not combine.** `handoff-scout` holds one grounding reply for a fixed two-ticket handoff, so `ground-briefs` cannot succeed on a `demo` session. The export then goes out ungrounded, with the File boundaries and Codebase facts slots empty.
- Grounding, and anything about content quality, can only be tested with the real interviewer. Ask the owner first: it spends the shared subscription.

### The app's MCP endpoint

The owner's server also serves MCP at `http://localhost:8082/mcp` (`agent-native-localhost` in mcp-cli). Do not use it for this procedure:

- It calls the same actions, but it needs the owner's bearer token.
- By default it lists only a small set of tools, plus `tool-search`.

The plain action routes above are what this skill is written and tested against.

## The sequence

| Step | Action and body | Session state after | Notes |
|---|---|---|---|
| 1 | `list-projects` (GET), or `register-project {root, verifyCommand, exportFolder}` | | This repo's project is `poc-grill-me` with `exportFolder: ".grill-room"`. `update-project {id, exportFolder}` changes it |
| 2 | `create-session {title, idea, projectId}` | `interviewing` | Keep the idea in a file (`idea.txt`) and load it. Do not also pass `docsFolder` for a repo that contains `grill-room/`: it is refused with `folder-contains-app`. The project gives the interviewer the repo |
| 3 | `scout-project {sessionId}` | `interviewing` | Needs a project. Optional: step 4 runs the scout itself when no current report exists. The report may propose decisions; `keep-repo-decision` or `drop-repo-decision` settles each, as the owner chooses |
| 4 | `assess-readiness {sessionId}` | `interviewing` | Only before the first round (`has-rounds` after). With a project and no current scout report, it runs the scout first, as a second turn. Read the verdict before continuing; it never blocks the interview |
| 5 | `request-next-round {sessionId}` | `interviewing` | Returns `{round: {id, decisions: [...]}}`. Each decision has `key`, `questionTitle`, `questionBody`, `choices`, `recommendedAnswer` |
| 6 | `grill.py answer roundN.json rN-answers.json submitN.json` | `interviewing`, then `done-proposed` | Saves each card with `save-draft-answer {decisionId, answerKind, answer?}` and submits with `submit-round {id: roundId}`. The result carries the next `round`, or `doneSummary` when the frontier is empty |
| 7 | `confirm-session {sessionId}` | `confirmed` | Only from `done-proposed`, and only once the owner confirms the done summary. It asks the interviewer for nothing |
| 8 | `synthesize-spec {sessionId}` | | About 1–2 minutes |
| 9 | `break-into-tickets {sessionId}` | | About 1 minute. `force: true` only when replacing tickets that have a build record |
| 10 | `generate-handoff {sessionId}` | | `overwriteEdits: true` only when the owner agrees to lose hand edits |
| 11 | `ground-briefs {sessionId}` | | The slow one: 10 to 40 minutes. It reads the repo at its current commit |
| 12 | `preview-export` (GET, `sessionId`, optional `slug`) | | Check `exportBlocked`, `groundingState`, `ungroundedBriefs` and `plannedWrites`. Grounding never blocks the export: an ungrounded brief goes out with empty slots |
| 13 | `export-session {sessionId, slug}` | | `overridePaths` only for edited files the owner agreed to overwrite |

Save every response to a file in the scratchpad (`round1.json`, `submit1.json`, `spec.json`, …) so a later step, or a later session, can read it instead of calling again.

## Answering rounds

The answers are the owner's. For a real session, put each round's cards to the owner with AskUserQuestion: the recommended choice first, one question per card, at most four per call. Write their answers into `rN-answers.json`:

```json
{"card-key": ["accepted-recommendation", null],
 "other-key": ["own-answer", "Two explicit folders"]}
```

`answerKind` is one of `accepted-recommendation`, `own-answer`, `unknown`, `pushed-back`, `deferred` or `prototype-flagged`. `own-answer` and `pushed-back` need the text. An owner's reply that picks a choice other than the recommendation is an `own-answer` carrying that choice's label. Answer only a fake-interviewer session without asking.

## Long calls

Steps 3, 4, 5, 6, 8, 9, 10 and 11 each wait for the interviewer. Run them with the Bash tool's `run_in_background` and wait for the completion notice. Several steps can be chained in one background command, for example 10 and 11. Never poll with `sleep`. Only one turn runs per session at a time: a call made while one is working is refused with `turn-working` (409).

## Errors seen before

| Symptom | Cause | Fix |
|---|---|---|
| Refused, or `Session not found` | `{id}` sent where the action takes `{sessionId}`, or the reverse | Session actions take `sessionId`. `submit-round` takes the round's `id`. `get-session` (GET) takes `id` |
| `Method not allowed. Use GET.` | A read action was POSTed | Use `grill.py get` |
| `folder-contains-app` | `docsFolder` was a repo that contains `grill-room/` | Create the session with `projectId` only |
| `groundingState: "stale"`, `groundingStaleReason: "head-moved"` | A commit landed after `ground-briefs` ran | Run `ground-briefs` again, or export with the stale grounding and say so. Commit nothing between grounding and export |
| `has-rounds` from `assess-readiness` | The first round was already requested | Judge readiness before step 5 |

## After the export

- The project's `verifyCommand` is copied into HANDOFF.md and the briefs as given; nothing runs it. Check that it works in the target repo.
- Read the bundle before reporting it done: `spec.md`, `decisions.md`, `HANDOFF.md` and at least one brief.
- Check it against the readiness items in `docs/reviews/pipe-export-review.md`. That file lists the known export defects; say which ones this bundle shows.
- Turning the tickets into beads and building them follows `CLAUDE.md` ("Build Flow") and `.claude/rules/worktrees.md`.
