# Chat — Agent Guide

Chat is the minimal chat-first agent-native app. The public root is a marketing
surface; the authenticated chat app starts at `/home`. Actions carry the real
capabilities, and screens exist only where a workflow needs durable UI around
the conversation.

## Skills

The default app skill surface is intentionally small. Promotion, learning,
translation, changelog, provider, and release workflows are optional; enable
the matching skill only when this app actually uses that workflow. The
`docs-search` action reads the version-matched framework docs bundled with
  `@agent-native/core`; `source-search` reads core and first-party template
  implementations. Prefer both over memory when package APIs, actions, or agent
  surfaces are involved.

## Core Rules

- UI feedback: target 100 ms, never exceed 400 ms; acknowledge before network work.
- Follow the root framework contract: data in SQL, actions first, application
  state for navigation/selection, and shared agent chat for AI work.
- Store large file/blob payloads in configured file/blob storage, not SQL: no
  base64, `data:` URLs, images, video/audio, PDFs, ZIPs, screenshots,
  thumbnails, or replay chunks in app tables, `application_state`, `settings`,
  or `resources`; persist URLs, ids, or handles instead.
- Never hardcode API keys, tokens, webhook URLs, signing secrets, private
  Builder/internal data, customer data, or credential-looking literals. Use
  secrets/OAuth/runtime configuration and obvious placeholders in examples.
- For external integrations, inspect the workspace/provider connection catalog
  first. Reuse an existing connection and its scoped credential resolver; only
  use app-local vault/OAuth/settings primitives when no reusable connection
  exists. Keep custom setup UI provider-specific and never duplicate storage.
- Keep actions deterministic and focused. Research, analysis, generation,
  recommendation, and synthesis start in the AgentSidebar and let the agent
  orchestrate its tools; follow-ups stay in the same thread rather than moving
  the user to a second freeform prompt box.
- Never fabricate. If an action fails or data is missing, say so and recover
  instead of inventing a result or claiming success.
- Verify a write before reporting it done — re-read the row or the screen.
- Use `view-screen` or application state when the active page/selection is
  unclear.

For a custom app, keep `server/plugins/config.ts` aligned with the product
brand. Its `app.name` is used in transactional emails, and its optional
`app.logoUrl` can point to an absolute HTTPS logo URL.

## Actions

The app's capabilities, in `actions/`. Reads are GET actions; the rest mutate.

| Action | Purpose |
| --- | --- |
| `create-session` | Start a grilling session from a loose idea, defaulting the interviewer model to the global default. Optionally names the registered project it exports into (`projectId`); refused with `project-not-found` for an unknown one. |
| `list-sessions` | Every session with its title, state, last activity, and `readinessVerdict` (`ready`, `not-ready`, or null when the current idea has not been judged), most recently active first. |
| `get-session` | One session by id, so resuming lands where it left off; carries a derived `modelLocked` flag. |
| `update-session-idea` | Replace a session's idea before its first round: trimmed, refused empty (`idea-required`). Clears the stored readiness judgment. Refused with `has-rounds` once any round exists and `turn-working` while a turn is working. Returns the session. |
| `assess-readiness` | Ask the interviewer whether a session's idea is ready to be grilled, store the judgment, and return it. Refused with `has-rounds`, `turn-working`, or `wrong-session-state` outside interviewing. Never blocks starting the interview. See "Idea readiness" below. |
| `delete-session` | A session and everything under it: decisions, history, rounds, spec, tickets, build records. |
| `set-session-answering-mode` | Switch a session between whole-round and one-at-a-time answering. |
| `set-session-model` | Change a session's interviewer model before its first round. Refused with `model-locked` once the session's interviewer conversation exists or while a turn is working. |
| `get-default-model` | The global default interviewer model new sessions pre-fill with; `fable` when unset. |
| `set-default-model` | Set that default. |
| `get-setting` / `set-setting` | Read and write one app-wide setting. |
| `get-tree` | A session's whole design tree: every decision, what it depends on, its answer, its previous answers with the interviewer's reason for superseding each, and its derived state. |
| `get-current-round` | The round a session is answering, with each card's question, recommendation, derived state, and saved draft — plus the session's state, its done-proposal summary when it has one, whether the interviewer is working, idle, or failed, the idea's `readiness` (null when none, or when it judged an earlier idea), and `canEditIdea` (no round yet, no turn working). |
| `list-rounds` | Every round of a session in order, with the questions asked and the answers given. |
| `request-next-round` | Review whatever a reopened answer put in doubt, then ask the interviewer for the next round, validate the proposal against the tree — including a done proposal, accepted only once nothing would still be asked — and open the round. A session that had proposed or confirmed done returns to interviewing the moment a round actually opens. |
| `save-draft-answer` | Save one card's draft answer — accepted recommendation, own answer, or a steering move (unknown, pushed back, deferred, prototype flagged) — so a half-answered round survives a reload. |
| `submit-round` | Settle an open round's decisions (a steering move does not settle its decision) and ask for the next round. Refuses a round with unanswered cards. |
| `reopen-decision` | Reopen a settled decision: its answer becomes history, it is asked again straight away, and everything under it goes stale until the interviewer reconfirms or re-asks it. Returns a done-proposed or confirmed session to interviewing and clears the done summary; leaving `confirmed` also marks the session's spec not current. |
| `add-decision` | Add a decision the user thought of themselves; it awaits the interviewer's placement in the tree. Returns a done-proposed or confirmed session to interviewing and clears the done summary. |
| `apply-reopen-batch` | Apply a list of reopens whose answers are already decided, in order, and report what happened to each. See "Applying a batch of reopens" below. |
| `answer-decision` | Give a real answer to an unresolved loose end (unknown, deferred, prototype flagged, or an unanswered push back) outside a round, without calling the interviewer. Call `request-next-round` afterwards: that is where a reopened decision's dependents are reviewed. |
| `list-loose-ends` | Every decision blocking confirmation of a session — unknown, deferred, prototype flagged or pushed back and not withdrawn, stale, unplaced, or never answered — each with a reason naming its category, and the supersession proposed on it when it has one. Empty once nothing blocks confirming. |
| `find-superseded` | Ask the interviewer which open loose ends a decision that settled later has already answered, and store what it finds on each as a proposal. Runs automatically as the second half of a done proposal; this action repeats it on demand. Allowed while interviewing or with a done proposal pending, refused while a turn is working. |
| `accept-supersession` | Accept the supersession proposed on a loose end: the answer found in the superseding decision becomes its own answer and it settles, the steering move it held moving to history with the interviewer's reason. |
| `dismiss-supersession` | Reject that proposal and leave the loose end exactly as open as it was. Answering the loose end, setting it aside, or reopening the superseding decision clears it too. |
| `disposition-decision` | Resolve a loose end by moving it out of scope or into the notes as a named open question, instead of a real answer. Settles the decision (as dispositioned) without calling the interviewer; refuses a decision that is not a loose end, or one that is stale or unplaced. |
| `confirm-session` | Confirm a session whose done proposal is pending. Refuses outside `done-proposed`, refuses with the list of loose ends while any remain, and refuses while a turn is working. |
| `synthesize-spec` | Synthesize the session's spec from its settled decisions, following the upstream to-spec template verbatim. Allowed only for a confirmed session with no turn working. Dispositioned decisions feed Out of Scope and Further Notes. Regenerating replaces the markdown and returns the spec row. |
| `get-spec` | A session's spec, or null when none has been synthesized yet, plus a `ticketsCurrent` flag: whether any generated tickets still match it. |
| `break-into-tickets` | Break the session's current spec into implementation tickets, replacing any it already has. Allowed only for a confirmed session with a current spec and no turn working. Refuses to replace tickets carrying a build record unless `force` is set. Returns the same shape as `list-tickets`. |
| `list-tickets` | A session's tickets in number order, each with `blockedBy` resolved to ticket numbers, the same `ticketsCurrent` flag as `get-spec`, and `waves`: ticket numbers grouped by the topological layering of `blockedBy` (wave 1 has no blockers, each later wave's blockers are all in an earlier one). |
| `set-ticket-blocked-by` | Edit which other tickets in the session block a ticket, given `ticketId` and the new `blockedBy` as ticket numbers. Refuses a self-reference, a number that is not a ticket in the session, or an edit that would create a cycle (`errorCode` `self-reference`, `unknown-ticket-number`, or `cycle`, the last naming every ticket on it). Never touches the spec's `ticketsGeneratedAt`. Returns the same shape as `list-tickets`. |
| `register-project` | Register a repository sessions export into. The root (any folder inside the repo) is resolved to its git top-level with read-only `git rev-parse`; root and verify command are required, the rest default (slug pattern `{slug}`, tracker `markdown`, build-record logging off). A blank export folder or slug pattern falls back to the repo's declared tracker block (`docs/agents/issue-tracker.md` front matter — see "Declared tracker" below) when it has a valid one, otherwise export folder is required and slug pattern falls back to `{slug}`. The tracker's commands and diagnostic are stored on the project either way. The visibility flag is seeded from `git check-ignore` on the export folder unless given. Refusals carry a code: `root-required`, `verify-command-required`, `export-folder-required`, `folder-not-absolute`, `folder-not-found`, `folder-not-directory`, `not-a-git-repo`, `git-unavailable`, `export-folder-outside-root`, `export-folder-is-root`, `invalid-slug-pattern`, `project-exists`. |
| `update-project` | Edit a registered project. Omitted fields keep their value and the result is validated exactly as registration validates it; the visibility flag changes only when given. Never re-reads the declared tracker — its stored commands and diagnostic pass through unchanged. |
| `list-projects` | Every registered project, by name. |
| `get-project` | One registered project by id. |
| `suggest-project-defaults` | What registering a folder would detect, without registering it: the git root, a default name, a verify command suggested from the repo's justfile, package.json scripts or Makefile (in that order; `verify`, then `check`, then `test` within each), an export folder and slug pattern suggested from a declared tracker block when the repo has a valid one, and the visibility `git check-ignore` seeds for a given export folder. |
| `refresh-project-tracker` | Re-read a project's declared tracker and update only what it governs: the stored commands and diagnostic always, and the export folder and slug pattern only when the tracker is valid. Nothing else about the project changes, and nothing else re-reads the tracker file — every ordinary edit carries these fields over untouched. |
| `set-session-project` | Set the registered project a session exports into, or clear it with `null`. Export requires one. |
| `set-docs-folder` | Set the read-only folder the interviewer may read while grilling this session, or clear it with `null`. See "Grill with docs" below. |
| `preview-export` | What exporting a session would do, with no side effects: the slug proposed from the title (its first four words), the slug used (the optional `slug` input, sanitized), the folder name the project's slug pattern resolves to, the absolute bundle directory, every file that will be written as an absolute path (HANDOFF.md and the briefs when a handoff exists, and the manifest), `handoffIncluded`, the files from the previous manifest that will be removed, the project's tracker diagnostic, and the export gate as `exportBlocked`/`exportBlockedReason` (`handoff-missing` or `handoff-stale`, null once clear) — the same gate `export-session` refuses on, reported here without refusing so the UI can explain it first. Built by the same plan `export-session` writes. |
| `export-session` | Export a session into its project, given `sessionId` and the confirmed `slug`: `<root>/<exportFolder>/<folderName>/spec.md` plus `issues/NN-slug.md` per ticket (tickets only when current), and `HANDOFF.md` plus `briefs/NN-slug.md` from the session's generated handoff (recording that export on the handoff), creating missing folders. Also writes a manifest (`.grill-room-export.json`) of what it wrote; re-export overwrites the planned files and removes exactly the files the previous manifest lists that the new plan no longer writes, never anything else. Writes exactly what `preview-export` lists. Refuses, writing nothing, with `no-project`, `project-not-found`, `project-root-missing`, `spec-missing`, `spec-not-current`, `invalid-slug`, `invalid-folder-name`, `export-outside-root` when any path resolves (through symlinks) outside the real project root, `handoff-missing` when the session has no handoff, or `handoff-stale` when its handoff no longer matches today's spec, tickets or project. Also returns a post-export visibility report — see "Exporting a session" below. |
| `get-export-visibility` | Classify every file a session's export wrote (or would write) as `tracked`, `ignored`, or `untracked` in the project's repository, given the same `sessionId` and `slug` as `preview-export`/`export-session`. Read-only and side-effect-free, so the UI can re-check without exporting again. See "Exporting a session" below. |
| `generate-handoff` | Generate or regenerate a session's handoff from deterministic templates (no model call): `HANDOFF.md` plus one brief per ticket. Refuses with `no-project`, `project-not-found`, `spec-missing`, `no-tickets` or `ticket-cycle`, and with `handoff-edited` when the stored handoff carries UI edits unless `overwriteEdits` is true. See "Handoff" below. |
| `get-handoff` | A session's handoff (HANDOFF.md, briefs by ticket number, timestamps) or null, with `stale` (its inputs changed since generation), `exportStale` (edited or regenerated after the last export that included it), `canGenerate`, and `cannotGenerateReason`. |
| `update-handoff` | Edit a generated handoff: replace HANDOFF.md's `markdown` and/or `briefs` by `ticketNumber`. Marks it edited, so regenerating needs `overwriteEdits`. Refuses with `handoff-missing` or `brief-not-found`. |
| `set-build-record` | Create or edit a ticket's build record — model, whether the first attempt passed, whether it was escalated, what the prompt was missing, and free notes — identifying the ticket by `ticketId` or by `sessionId` + `ticketNumber`. Optionally updates the ticket's `status` in the same call. See "Logging a build from an agent" below. |
| `get-build-record` | One ticket's build record, or null when none has been logged yet. |
| `get-build-summary` | A session's build records summarized: ticket and recorded counts, first-attempt pass rate, escalations, a per-model breakdown, and every ticket with its build record or null — one call for the whole build records table. |
| `navigate` | Move the UI to a view or path, through application state. |
| `view-screen` | What the user is looking at. Call it first when the visible context matters. |
| `provider-api-request` | Call Slack's Web API through the workspace connection. |

`request-next-round`, `submit-round`, `find-superseded`, `synthesize-spec`,
`break-into-tickets`, `assess-readiness`, and `apply-reopen-batch` (one or two
turns per item)
all wait on a Claude CLI turn, which takes about a minute and can take several.
The client action hooks time out at 60 s by default, so UI code calling any of
them must pass a `timeoutMs` of several minutes; the default cancels a turn
that was about to succeed and leaves the session's `turn_status` reading
`working`.

### Applying a batch of reopens

`apply-reopen-batch` takes a list of `{ decisionKey | decisionId, answer }`
items and applies them **in order**, plus optional `newDecisions` added once
every item has landed. It is what a comparison against an existing system
produces: a set of changes already agreed, rather than one decision to rethink.

The order matters because each item changes the tree the next one meets.
Reopening a decision makes its dependents stale, and the stale review that
follows re-asks the ones the new answer broke — so an item further down the
list may be open again by the time the batch reaches it. Each item is therefore
applied against the tree *as it then stands*:

- **settled or stale** — reopened, answered as an own answer, round submitted
  (`reopened`). Every other card of that round with no draft is **deferred**, so
  the round can be submitted without the batch answering a question it was not
  given; the interviewer asks those again.
- **open and a card of the round** — answered there and submitted
  (`answered-as-card`). This is the case `reopen-decision` refuses with
  `decision-not-settled`.
- **open and a loose end** — answered through `answer-decision`
  (`answered-as-loose-end`). No interviewer turn, so ask for the next round
  afterwards if it is the last item.
- **anything else** (blocked, withdrawn, unplaced) — `not-reopenable`, nothing
  written, and the batch carries on.

It stops at the first failure, returns every outcome up to and including it with
`failedAt` set, and leaves `newDecisions` unadded. It refuses while a turn is
working (`turn-in-progress`) or another batch is running (`batch-in-progress`),
and refuses the whole call if any item names a decision this session does not
have (`decision-not-found`) — a list with a typo in it should not cost several
interviewer turns before saying so.

Because a batch is one or two real turns per item, its progress is stored on the
session as `gr_sessions.batch_progress_json` (`{ total, completed, current,
outcomes }`) and cleared when it ends. `get-session` carries it, which is how
the workspace shows a batch it did not start and how a reload mid-batch lands
somewhere truthful.

### Idea readiness

An idea that names nothing to build ("decide how to evaluate eight repos")
produces a first round about methodology. Before the first round, the session
can be judged for grill-readiness with `assess-readiness`, which runs one more
interviewer request kind, `assess-readiness`, through the same turn lock,
retries, structured output, docs-folder mode and fake interviewer as the rest.

The result is `{ evidence, objective, objectiveIsProcess, expectedOutcome,
unknowns, verdict, missing }`: evidence quoted in the idea's own words, the
single buildable objective or null, whether that objective is a process
(evaluate, decide how, compare, define a method), the expected outcome or null,
the unknowns it raises, `ready` or `not-ready`, and what the idea still needs.
`ready` requires at least one evidence item, a non-null objective that is not
process, and at most five unknowns; a `ready` verdict breaking that rule is sent
back with the reasons and, once retries are spent, fails the turn with
`invalid-readiness`. The judge runs in a conversation of its own: the session's
`conversationId` is left as it was, so the model stays changeable and the first
round starts fresh.

It is stored as `gr_sessions.readiness_json` (`{ ideaJudged, result,
judgedAt }`). A judgment whose `ideaJudged` differs from the current idea reads
as absent everywhere (`get-current-round`'s `readiness`, `list-sessions`'
`readinessVerdict`). `update-session-idea` edits the idea while the session has
no rounds and no turn working, and clears the judgment; re-judging is the
user's call. Nothing blocks the first round on a `not-ready` verdict.

In the UI, the session page shows a readiness panel above the start panel
while the session has no rounds (`readiness-panel`, with `readiness-assess`
or `readiness-reassess` and the `readiness-verdict` badge); a working turn
disables its action and the one working panel below carries the elapsed time.
The idea block offers `idea-edit` while `canEditIdea` is true, and the session
list shows `session-readiness-badge` next to the state badge for a judged idea.

### Grill with docs

A session may carry a **docs folder**: one absolute, existing directory the
interviewer may read while grilling, so it can align its questions with a system
that already exists instead of designing it again. Set it at creation
(`create-session --docsFolder`) or later (`set-docs-folder`); `null` clears it.
Without one, nothing about the interview changes.

The folder is the one place the app points the model at the user's own
filesystem, so the rules are narrow and enforced in three places at once:

- **The action refuses a folder that is too wide.** It must be absolute (a
  leading `~` is expanded), exist, be a directory, and be none of: the
  filesystem root, the home directory itself, or any folder containing this app
  — a docs folder that is a parent of Grill Room would let the interviewer read
  the app's own `.env`. Each refusal has its own error code
  (`folder-not-absolute`, `folder-not-found`, `folder-not-directory`,
  `folder-is-root`, `folder-is-home`, `folder-contains-app`).
- **The adapter narrows the turn.** The folder becomes the child's working
  directory and the invocation adds `--tools Read,Grep,Glob`, the same three in
  `--allowed-tools`, `--add-dir <folder>`, `--restricted`,
  `--strict-mcp-config`, `--disable-slash-commands` and
  `--permission-prompts none`. `--restricted` is what actually confines the file
  tools to the working directory: the CLI has no flag that scopes a single tool
  to a path. What is *not* prevented: a `CLAUDE.md` or `AGENTS.md` inside the
  docs folder is still auto-discovered and prepended as context. Only `--bare`
  skips that, and `--bare` refuses OAuth, which is how this app authenticates.
- **The instructions keep the decision the user's.** When the folder already
  answers a question the interviewer still asks it, with the finding as the
  recommendation and the file path cited in the question body. A folder can be
  out of date, and a decision the user did not make is not a decision.

No version of this writes to the folder.

### Declared tracker

A project's repository may declare a tracker as a front-matter block at the
very top of `docs/agents/issue-tracker.md`, relative to the project root:

```
---
tickets_dir: .scratch/tickets
ticket_format: "{seq}-{slug}"
commands:
  claim: bd update {id} --claim
  close: bd close {id}
---
```

Three fixed keys, all required for the block to count as valid: `tickets_dir`
(a folder relative to the root — not absolute, not resolving outside it),
`ticket_format` (a slug pattern using the placeholders `register-project`
accepts, e.g. `{seq}`, `{date}`, `{slug}`), and `commands` (a map of command
name to shell command). A missing file, or a file without this block (prose
only), reads as no tracker. A block missing a key, or with an invalid
`tickets_dir`/`ticket_format`, reads as invalid, with a diagnostic naming the
offending key. See `server/tracker.ts` for the exact parser.

The tracker is read only at registration and by `refresh-project-tracker`:
`register-project` stores its commands and diagnostic and, for any export
folder or slug pattern the caller left blank, pre-fills them from a valid
tracker (the fixed layout otherwise). `update-project` never re-reads it — the
stored commands and diagnostic pass through every ordinary edit unchanged, so
editing the tracker file has no effect until `refresh-project-tracker` is
called. Only that action then updates the export folder and slug pattern, and
only when the newly-read tracker is valid.

### Exporting a session

Export always goes into the session's registered project; a session without
one cannot be previewed or exported (`no-project`). Call `preview-export`
first, show its paths, then call `export-session` with the slug the preview
used. Both build the plan in `server/export-bundle.ts`, so they cannot
disagree.

**Export is gated on a current handoff.** `export-session` refuses, writing
nothing, with `handoff-missing` when the session has never generated one, or
`handoff-stale` when it no longer matches today's spec, tickets or project (the
same fingerprint `generate-handoff`'s staleness uses — a `set-ticket-blocked-by`
edit counts, since it never touches `ticketsGeneratedAt`). `preview-export`
never refuses on this: it reports the same check as `exportBlocked` and
`exportBlockedReason`, so the UI can explain and disable before the operator
tries, and still show every other preview detail (paths, removals, tracker
diagnostic) regardless. Generate or regenerate the handoff (`generate-handoff`)
to clear it. This means a bundle can no longer reach disk without an entry
point — see "Handoff" below.

The bundle is one directory per session:

```
<root>/<exportFolder>/<folderName>/HANDOFF.md
<root>/<exportFolder>/<folderName>/spec.md
<root>/<exportFolder>/<folderName>/issues/NN-slug.md   # "Blocked by: NN, NN" line
<root>/<exportFolder>/<folderName>/briefs/NN-slug.md
<root>/<exportFolder>/<folderName>/.grill-room-export.json
```

`.grill-room-export.json` is the export's manifest: the relative paths of the
other files that export wrote. It is part of the plan, listed in the preview
and checked for containment like every other file. Re-export overwrites every
planned file and removes only the paths the previous manifest lists that the
new plan no longer contains (a dropped ticket, say). A file the previous
manifest does not list is never removed, whatever its name or folder; a bundle
with no manifest, or a malformed one, gets no removals.

`folderName` is the project's slug pattern with its placeholders filled:

- `{slug}`: the slug, sanitized to lowercase ASCII letters, digits and single
  hyphens (at most 60 characters). The proposal is the session title's first
  four words. A slug that sanitizes to nothing is refused (`invalid-slug`).
- `{date}`: today's local date, `YYYY-MM-DD`.
- `{seq}`: if a folder already matches the pattern with the same slug and date,
  it is reused, so re-exporting lands in the same folder. Otherwise it is one
  more than the highest numeric prefix among existing folders in the export
  folder, padded to two digits (`01` when there are none).

Before anything is written, every path is resolved with `fs.realpath` (the
deepest existing ancestor of each) and refused with `export-outside-root`
unless it lands inside the real project root. That covers an export folder,
or an `issues/` folder, that is a symlink out of the repository.

`export-session` also returns a post-export visibility report (`server/visibility.ts`),
built the same way `get-export-visibility` builds it on demand: every written
file classified `tracked`, `ignored`, or `untracked` with two batched
read-only git calls, a plain warning plus the exact command to run when
agents will not see a file, and a separate warning when the project's
`visibility` flag disagrees with what was observed. Grill Room never stages
or commits in the target repo — the remedy commands are for the operator to
run by hand.

### Handoff

`generate-handoff` renders a session's handoff with plain TypeScript templates
(`server/handoff.ts`) over the session, spec, tickets, their waves (from
`blockedBy`, via `computeWaves`) and the project. No model is called; the same
inputs render the same text. It is stored in `gr_handoffs`, one row per
session, and is readable and editable in the output page's Handoff block.

- `HANDOFF.md` is the entry point for a fresh orchestrating session: the
  session title and idea, the spec path, the waves (each ticket with its
  ticket file and brief), the verify command, the PR-based worktree
  lifecycle (embedded whole, so the target repo needs no rules file), and
  what to record per ticket. Beads projects get bead commands (the declared
  tracker's stored commands when present); markdown projects get a
  `Status:` line per ticket instead. Build-record commands, with the session
  id and ticket numbers filled in, appear only when the project logs build
  records.
- `briefs/NN-slug.md` (the same `NN-slug` as the ticket file) holds the
  ticket text, its blockers, the verify command, the file-boundary,
  git/worktree and PR rules, the report format, and "report, then stop",
  plus two labelled empty slots for the orchestrator: **File boundaries**
  and **Codebase facts**. Nothing is pre-filled from the target repo.
- Bundle paths are stored as `{{BUNDLE}}` and filled in at export from the
  project's visibility flag, without re-checking git: `tracked` gives paths
  relative to the repo root plus a commit-and-push-before-delegating step;
  `ignored` gives absolute paths into the main checkout and tells worktree
  agents to read the bundle by absolute path.

The handoff is **stale** when a fingerprint over everything it renders
differs from the one it was generated from: the session's title and idea,
the spec's `updatedAt` and `ticketsGeneratedAt`, each ticket's id, number,
slug, title, body and `blockedBy`, and the project's root, export folder,
verify command, tracker kind, tracker commands, build-record toggle and
visibility. That is what catches a `set-ticket-blocked-by` edit, which does
not touch `ticketsGeneratedAt`. An edit is not a change of inputs: an edited
handoff stays current, but regenerating over it needs `overwriteEdits`.

When a handoff exists, `preview-export`/`export-session` plan `HANDOFF.md`
and the briefs like any other bundle file (listed, contained, recorded in the
manifest, so a dropped ticket's brief is removed on re-export), and export
records the handoff's fingerprint, revision and time. The handoff is
**export stale** once it is edited or regenerated after that.

**Export requires a current handoff** — see the gate in "Exporting a session"
above. `stale` (fingerprint mismatch) is what the gate checks; `exportStale`
(edited or regenerated since the last export) is a separate, informational
flag and never blocks export on its own.

The output page's **Generate everything** button (`GenerateAllAction`, next to
Export) is a secondary shortcut, not a new action: it calls `break-into-tickets`
only when the session has none or they are out of date, then `generate-handoff`,
then scrolls to the export preview. It writes nothing to disk — export stays
its own explicit, confirmed step — and if the stored handoff carries edits it
pauses on the same overwrite confirmation `generate-handoff`'s `handoff-edited`
refusal always requires, rather than discarding them. The individual actions
(write the spec, break into tickets, generate the handoff, export) remain the
primary, always-visible controls; regenerating the handoff alone stays
available from the Handoff block regardless.

### Logging a build from an agent

`set-build-record` is reachable over HTTP and the framework's action command
line, so an orchestrating agent can log a build's outcome without a browser.
Identify the ticket either with `ticketId`, or with `sessionId` +
`ticketNumber` (what an orchestrating agent knows from the exported ticket
file's number, not its id). `model` is required free text; booleans are
`true`/`false`; free text with spaces is just a normal argument, quoted for
the shell.

HTTP:

```bash
curl -s -X POST http://localhost:5210/_agent-native/actions/set-build-record \
  -H "Content-Type: application/json" \
  -d '{
    "ticketId": "<ticket-id>",
    "model": "sonnet",
    "firstAttemptPassed": true,
    "escalated": false,
    "notes": "Passed first try, straightforward spec.",
    "ticketStatus": "done"
  }'
```

Command line (booleans as `--flag value`, the `sessionId` + `ticketNumber`
form, free text quoted):

```bash
pnpm action set-build-record \
  --sessionId <session-id> --ticketNumber 2 \
  --model opus --firstAttemptPassed false --escalated true \
  --promptMissing "no mention of the retry policy" \
  --notes "escalated from sonnet after two failed attempts" \
  --ticketStatus in-progress
```

`pnpm action` forwards to an already-running `pnpm dev` server over HTTP
when one is detected (a `.agent-native/dev-server.json` discovery file
naming a live process whose database matches); only when no such server is
running does it open the embedded database itself. This is why the command
line is safe to run alongside `pnpm dev`: it never opens PGlite's file lock
while the dev server already holds it.

## Application State

- `navigation` describes the current view and selected entity ids. The default
  chat view is `chat` at `/home`; `/` is the public SSR marketing page.
- `navigate` moves the UI when the app supports it.
- `view-screen` is the first tool to call when the user's visible context
  matters.
- `provider-api-request` calls Slack through the shared workspace connection.
  Use `provider: "slack"` and an exact Web API path such as `/auth.test`.
  Missing access pauses the run and opens the contextual connection card; do
  not ask the user to paste credentials or replace the request with prose.

## Source Changes

Before building common workspace or agent UI, read `agent-native-toolkit`; read
`customizing-agent-native` before adapting shared UI.

- Guarded verification: run `pnpm agent-native:doctor`; fix findings before done.
