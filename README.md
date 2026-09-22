# grill-room

A local app that runs Matt Pocock's grilling interview as a workspace instead
of a chat: rounds of question cards, a design tree whose states the app
derives, steering moves, reopening with a stale review of everything
downstream, a done gate, then spec synthesis and ticket breakdown. It is built
on the [agent-native](https://www.agent-native.com/) framework and drives
Claude through the Claude Code CLI on a subscription — no API key anywhere.

It is also the subject of the experiment that produced it. One top-tier model
did all the judgment — grilling the idea, writing the spec, cutting tickets,
reviewing results, deciding what was done — and cheaper models did all the
implementation. Every delegation was recorded, so the split is measured rather
than asserted, and that record is the most reusable thing here.

An experiment, not a maintained product.

## What came out of it

| | |
|---|---|
| Delegated tasks | 32 tickets and 1 spike |
| Model split | 15 on Opus, 17 on Sonnet; the planning session wrote no implementation code |
| Escalations to a larger model | 0 |
| Delegation prompts with a gap the agent had to work around | 24 of 33 |
| Result | 38 actions, 437 tests, ~17,000 lines of TypeScript |

Zero escalations is a claim about the prompts, not the models: a ticket was not
delegated until it could be specified tightly, which moved the difficulty
upstream into planning. Every defect that survived the tests lived *between*
tickets, not inside one.

**Start here:** [`docs/poc-findings.md`](docs/poc-findings.md) — the write-up.
[`docs/delegation-log.md`](docs/delegation-log.md) — one row per delegated task
with the model, the outcome, and what the prompt was missing.

## Map

| Path | What it is |
|---|---|
| `docs/poc-findings.md` | The findings |
| `docs/delegation-log.md` | Per-task record: model, first-attempt outcome, prompt gap |
| `docs/design/session-retrospective.md` | The first real interview, in numbers |
| `docs/design/workspace-review.md` | Design review of the app, and its verification |
| `docs/spikes/claude-code-harness.md` | Why the app shells out to `claude -p` |
| `.claude/skills/` | The grilling skills, vendored verbatim |
| `.scratch/grill-room/` | The spec and tickets the skills produced |
| `grill-room/` | The app |

## Running the app

Requires the Claude Code CLI, authenticated on a subscription. Interview turns
are real model calls that take a minute or two each.

```bash
just setup
just dev        # http://localhost:8080
```

The `justfile` at the repo root owns the dev workflow. Only one process can
open the local database, so `just dev` refuses to start a second server and
points at the running one instead; `just status`, `just open`, `just stop` and
`just restart` find that server wherever it listens. `just dev-fake` runs the
UI against a fake interviewer, without calling the CLI.

`just test` runs the suite at the action boundary without opening a browser or
calling the CLI; `just e2e` walks a session through the real UI against a fake
interviewer; `just check` runs both plus the typecheck. `just --list` shows
every recipe, and `grill-room/DEVELOPING.md` covers the rest.

## Attribution

The skills under `.claude/skills/` are unmodified copies from
[mattpocock/skills](https://github.com/mattpocock/skills), MIT licensed — see
`.claude/skills/LICENSE`. They are kept verbatim on purpose: the experiment
measures them as published, so anything worth changing about them is recorded
as a finding instead of an edit.

Everything else is MIT licensed — see `LICENSE`.
