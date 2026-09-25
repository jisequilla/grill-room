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
| `register-project` | Register a repository sessions export into. The root (any folder inside the repo) is resolved to its git top-level with read-only `git rev-parse`; root and verify command are required, the rest default (slug pattern `{slug}`, tracker `markdown`, build-record logging off, adversarial review on). A blank export folder or slug pattern falls back to the repo's declared tracker block (`docs/agents/issue-tracker.md` front matter — see "Declared tracker" below) when it has a valid one, otherwise export folder is required and slug pattern falls back to `{slug}`. The tracker's commands and diagnostic are stored on the project either way. The visibility flag is seeded from `git check-ignore` on the export folder unless given. The delivery recipe is guessed from the repo's remotes with read-only `git remote -v` unless given: any remote gives `pull-request`, none gives `local-merge`. Refusals carry a code: `root-required`, `verify-command-required`, `export-folder-required`, `folder-not-absolute`, `folder-not-found`, `folder-not-directory`, `not-a-git-repo`, `git-unavailable`, `export-folder-outside-root`, `export-folder-is-root`, `invalid-slug-pattern`, `invalid-delivery-recipe`, `project-exists`. |
| `update-project` | Edit a registered project. Omitted fields keep their value and the result is validated exactly as registration validates it; the visibility flag changes only when given. Never re-reads the declared tracker — its stored commands and diagnostic pass through unchanged. Can change the delivery recipe and the adversarial review switch directly; editing never re-guesses the recipe from the repo's remotes. |
| `list-projects` | Every registered project, by name. |
| `get-project` | One registered project by id. |
| `suggest-project-defaults` | What registering a folder would detect, without registering it: the git root, a default name, a verify command suggested from the repo's justfile, package.json scripts or Makefile (in that order; `verify`, then `check`, then `test` within each), an export folder and slug pattern suggested from a declared tracker block when the repo has a valid one, and the visibility `git check-ignore` seeds for a given export folder. |
| `refresh-project-tracker` | Re-read a project's declared tracker and update only what it governs: the stored commands and diagnostic always, and the export folder and slug pattern only when the tracker is valid. Nothing else about the project changes, and nothing else re-reads the tracker file — every ordinary edit carries these fields over untouched. |
| `set-session-project` | Set the registered project a session exports into, or clear it with `null`. Export requires one. |
| `set-docs-folder` | Set the read-only folder the interviewer may read while grilling this session, or clear it with `null`. See "Grill with docs" below. |
| `scout-project` | Run the scout on a session's project: collect the repository's server facts, have the scout (always sonnet, read-only) report the project's current state and proposed repo decisions for the session's idea, check every citation against the project's files, and store the report on the session, replacing any earlier one. Every proposal starts undecided. Refused with `no-project`, `not-a-repo`, `wrong-session-state`, or `turn-working`. See "Project scout" below. |
| `get-scout-report` | Read a session's scout report, or null when it has none: the server facts, the current state and proposed repo decisions, the commit and idea it read, the model, when it ran, its turn record, the keep/drop state of each proposal, and `stale`. |
| `keep-repo-decision` | Keep one decision the session's scout report proposes: it enters the design tree settled, introduced by the repo, with the project's statement as its answer. Refused with `no-scout-report`, `proposal-not-found`, `already-kept`, `key-in-use`, `wrong-session-state`, or `turn-working`. See "Project scout" below. |
| `drop-repo-decision` | Drop one decision the session's scout report proposes: recorded as dropped, still reaching the interviewer as unenforced context. Refused with `no-scout-report`, `proposal-not-found`, `already-kept`, `wrong-session-state`, or `turn-working`. |
| `preview-export` | What exporting a session would do, with no side effects: the slug proposed from the title (its first four words), the slug used (the optional `slug` input, sanitized), the folder name the project's slug pattern resolves to, the absolute bundle directory, every file the export will write as an absolute path (spec.md, intent.md, decisions.md when the tree holds decisions or out-of-scope items, HANDOFF.md and briefs/NN-slug.md when a handoff exists, and the manifest), `handoffIncluded`, the files the previous manifest lists that the plan drops, the project's tracker diagnostic, and the export gate as `exportBlocked`/`exportBlockedReason` (`handoff-missing` or `handoff-stale`, null once clear) — the same gate `export-session` refuses on, reported here without refusing so the UI can explain it first. `plannedWrites` and `plannedRemovals` repeat every planned write and removal as `{ path, relativePath, edited }`: `edited` is true when the file on disk no longer matches the hash the previous manifest recorded for it, or was never written by Grill Room at all — see "Exporting a session" below for the guard. Also reports the session's brief grounding as `groundingState` (`absent`, `current` or `stale`) and `groundingStaleReason` (`head-moved` or `handoff-changed`, null while current or absent) — informational, like the other gate: it never blocks export — plus `groundedBriefs` (ticket numbers this plan actually writes grounded) and `ungroundedBriefs` (every other brief, as `{ ticket, reason }` — `edited`, `no-grounding`, `not-covered`, or `kept` — see "Grounding the briefs" below). Built by the same plan `export-session` writes, so the two cannot disagree; export-session checks for edits again when it writes, so this preview is not a lock. |
| `export-session` | Export a session into its project, given `sessionId` and the confirmed `slug`: `<root>/<exportFolder>/<folderName>/spec.md`, `intent.md`, `decisions.md` (when the tree holds decisions or out-of-scope items), `issues/NN-slug.md` per ticket (tickets only when current), and `HANDOFF.md` plus `briefs/NN-slug.md` from the session's generated handoff, re-rendered fresh with the session's current brief grounding wherever the text is eligible (recording that export on the handoff), creating missing folders. Also writes a provenance manifest (`.grill-room-export.json`: session id, export revision, scout commit, HEAD at export, and a CRLF-insensitive sha256 of every file written). Re-export removes files the previous manifest lists that the new export no longer writes. Edited files are kept: a planned write or removal already on disk that no longer matches the hash the previous manifest recorded, or that the previous manifest never listed, is neither overwritten nor removed unless its bundle-relative path is in `overridePaths` (a version-1 manifest's files are trusted as unedited once). The check is repeated from disk at write time, so a file edited after `preview-export` is kept unless overridden. An override resolving outside the bundle is refused with `override-outside-bundle`. Refuses, writing nothing, with `no-project`, `project-not-found`, `project-root-missing`, `spec-missing`, `spec-not-current`, `invalid-slug`, `invalid-folder-name`, `export-outside-root` when any path resolves (through symlinks) outside the real project root, `handoff-missing` when the session has no handoff, or `handoff-stale` when its handoff no longer matches today's spec, tickets or project; `preview-export` reports the same gate as `exportBlocked`/`exportBlockedReason` without refusing, and marks each edited file, so the UI can explain both before the operator tries. Returns `written`, `removed` and `kept` as absolute paths, `groundedBriefs` (ticket numbers actually written grounded) and `ungroundedBriefs` (every other brief written, as `{ ticket, reason }` — `edited`, `no-grounding`, `not-covered`, or `kept` when the hash guard left an already-edited copy on disk instead of writing the grounded text), plus a post-export visibility report — see "Exporting a session" below and "Grounding the briefs" below. |
| `get-export-visibility` | Classify every file a session's export wrote (or would write) as `tracked`, `ignored`, `untracked`, or `unchecked` ("could not check": git could not tell) in the project's repository, given the same `sessionId` and `slug` as `preview-export`/`export-session`. Read-only and side-effect-free, so the UI can re-check without exporting again. See "Exporting a session" below. |
| `generate-handoff` | Generate or regenerate a session's handoff from deterministic templates (no model call): `HANDOFF.md` plus one brief per ticket. Refuses with `no-project`, `project-not-found`, `spec-missing`, `no-tickets` or `ticket-cycle`, and with `handoff-edited` when the stored handoff carries UI edits unless `overwriteEdits` is true. See "Handoff" below. |
| `get-handoff` | A session's handoff (HANDOFF.md, briefs by ticket number, timestamps) or null, with `stale` (its inputs changed since generation), `exportStale` (edited or regenerated after the last export that included it), `canGenerate`, and `cannotGenerateReason`. |
| `update-handoff` | Edit a generated handoff: replace HANDOFF.md's `markdown` and/or `briefs` by `ticketNumber`. Marks it edited, so regenerating needs `overwriteEdits`. Refuses with `handoff-missing` or `brief-not-found`. |
| `ground-briefs` | Ground a session's handoff briefs in its project's code: one handoff scout turn (turn kind `handoff-scout`, always on sonnet, read-only over the project root, a conversation of its own) covering every ticket at once, reporting per ticket the files to create or edit, the existing files it builds on, cited codebase facts, what it needs from each blocker with the check that proves it, and the test and command that prove it. The result is checked against the handoff and the working tree before it is stored, replacing any earlier grounding. Refused with `no-project`, `not-a-repo`, `handoff-missing`, `handoff-stale`, `turn-working`, `too-many-tickets` or `too-many-blockers` (the last two before any turn is spent); a grounding refused three times fails the turn with `invalid-brief-grounding`. See "Grounding the briefs" below. |
| `get-brief-grounding` | A session's brief grounding or null: the scout's result per ticket, the commit and handoff fingerprint it was made for, the model, when it ran, its turn record, `current`, and `staleReason` (`handoff-changed` or `head-moved`, null while current). |
| `set-build-record` | Create or edit a ticket's build record — model, whether the first attempt passed, whether it was escalated, what the prompt was missing, and free notes — identifying the ticket by `ticketId` or by `sessionId` + `ticketNumber`. Optionally updates the ticket's `status` in the same call. See "Logging a build from an agent" below. |
| `get-build-record` | One ticket's build record, or null when none has been logged yet. |
| `get-build-summary` | A session's build records summarized: ticket and recorded counts, first-attempt pass rate, escalations, a per-model breakdown, and every ticket with its build record or null — one call for the whole build records table. |
| `navigate` | Move the UI to a view or path, through application state. |
| `view-screen` | What the user is looking at. Call it first when the visible context matters. |
| `provider-api-request` | Call Slack's Web API through the workspace connection. |
| `use-fake-scenario` | Test only: choose the fake interviewer's scripted scenario for one session, replacing any queue it already has. Works only when `GRILL_ROOM_INTERVIEWER=fake`; refused with `fake-interviewer-only` otherwise and `unknown-scenario` for a name the fake does not have. See "Project scout" below for the `scout-project` scenario. |

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

### Project scout

When a session has a project, the readiness panel can ground the idea in that
project before the interview starts. `scout-project` collects the
repository's server facts (commit, branch, remotes, dirty state, recent
commits, agent instructions, decisions folder, rules folder) with read-only
`git` and file checks, then runs a scout — always on `sonnet`, whatever the
session's interviewer model, with read-only `Read`/`Grep`/`Glob` access to the
project root under the same restrictions as docs-folder mode, plus deny rules
for secret files (`.env*`, keys, certificates, credential files). The scout
reports:

- **Current state** — what already exists relative to the idea, each item
  `built`, `partial` or `gap`, with citations.
- **Proposed repo decisions** — choices the project has already made that
  bear on the idea, each `recorded` (an ADR, agent instructions or a rules
  file) or `inferred` (read from code or configuration), with a citation and a
  one-line reason.

Every citation is checked against the project's files before the report is
accepted; a report citing a missing file or an out-of-range line is refused
and the scout is asked again. The report is stored on the session with the
commit and idea it read, so `get-scout-report` can say when it has gone
**stale** — the idea changed, or the project's `HEAD` moved — without a fresh
scout run happening on its own.

`keep-repo-decision` turns one proposal into a settled decision in the design
tree, introduced by the repo, that the interviewer can never ask again;
reopening it works like any other settled decision. `drop-repo-decision`
leaves it out of the tree, but it still reaches the interviewer as
unenforced context, alongside the current state, on every turn. Keeping and
dropping are allowed any time the session is interviewing and no turn is
working — including after rounds exist, which is also when `scout-project`
can be run again (a **re-scout**) to catch a project that moved.

Readiness runs the scout automatically when a session has a project and no
current report; `assess-readiness`'s judge then reads the report alongside
the idea, and its evidence says whether each item came from the idea or the
repo (with the repo item's citation).

In the UI, the readiness panel's project-scout block
(`scout-panel`) stays reachable for the whole interview, not just before the
first round: server facts, current state by group, proposed decisions with
`scout-decision-keep`/`scout-decision-drop`, a `scout-stale-badge` when
stale, and a re-scout control (`scout-run`/`scout-rescout`). The design tree
marks a kept repo decision with a `repo-marker` badge (`data-source`
`recorded` or `inferred`, the citation on hover).

`use-fake-scenario` (test only) chooses the fake interviewer's scripted
scenario for one session — `scout-project` among them — so a browser check or
Playwright test can drive a real scout run against a real fixture repository
without the CLI. Works only when `GRILL_ROOM_INTERVIEWER=fake`; refused with
`fake-interviewer-only` otherwise and `unknown-scenario` for a name the fake
does not have.

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
<root>/<exportFolder>/<folderName>/intent.md
<root>/<exportFolder>/<folderName>/decisions.md        # when the tree holds decisions or out-of-scope items
<root>/<exportFolder>/<folderName>/issues/NN-slug.md   # "Blocked by: NN, NN" line
<root>/<exportFolder>/<folderName>/briefs/NN-slug.md
<root>/<exportFolder>/<folderName>/.grill-room-export.json
```

`intent.md` is the why, for people: rendered from stored data alone, no model
call, so it states exactly what the session holds and nothing it does not.
It opens with the idea verbatim, then the readiness objective, expected
outcome, verdict, each evidence item marked as the user's statement or the
repo's (with its citation for repo evidence), and the unknowns — "Not judged
for this version of the idea" when the judgment is missing or was made for an
earlier idea — then the scout's current state of the project (each built,
partial and gap item with its citation and the commit the report read, saying
when the project has moved since). No scout section when the session was
never scouted. `intent.md` is always planned; it is not a decision source,
so the scout prompt never reads it.

`.grill-room-export.json` is the export's provenance manifest: the session
id, the export revision (the previous manifest's plus one, starting at 1, no
database column), the scout report's commit, the project's `HEAD` at export
time, and, for every file Grill Room wrote, its path and the sha256 of its
content with CRLF normalised to LF — no timestamps. It is part of the plan,
listed in the preview and checked for containment like every other file. A
version-1 manifest (paths only, no hashes) still parses; its files are
treated as written by Grill Room and unedited, once.

**The edited-file guard.** Before writing, every planned file already on disk,
and every file the previous manifest lists that the new plan drops, is
classified from disk: **unedited** when the previous manifest has its hash and
the file matches it (or the previous manifest is version 1 and lists the
path), **edited** otherwise — including a file the previous manifest never
listed at all. An edited file is kept — neither overwritten nor removed —
unless its bundle-relative path is passed in `overridePaths`; a kept file
stays in the new manifest with the hash Grill Room last wrote for it, and one
that was never hashed is not added. `preview-export`'s `plannedWrites` and
`plannedRemovals` mark each planned path `edited` so the UI can flag it before
the operator tries; `export-session` recomputes the classification from disk
at the moment it writes, so a file edited after the preview is still kept
unless its path was overridden. Every override must resolve inside the bundle
directory, through symlinks, or the plan is refused with
`override-outside-bundle`. `export-session` returns `written`, `removed` and
`kept` as absolute paths.

Re-export overwrites every planned, unkept file and removes only the unkept
paths the previous manifest lists that the new plan no longer contains (a
dropped ticket, say). A file the previous manifest does not list is never
removed, whatever its name or folder; a bundle with no manifest, or a
malformed one, gets no removals.

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
file classified `tracked`, `ignored`, `untracked`, or `unchecked` ("could not
check": git could not tell whether the file is ignored, e.g. it sits behind a
symlink `check-ignore` refuses to resolve) with two batched read-only git
calls, a plain warning plus the exact command to run when agents will not see
a file, a separate warning naming each unchecked file's git error, and a
separate warning when the project's `visibility` flag disagrees with what was
observed. Grill Room never stages or commits in the target repo — the remedy
commands are for the operator to run by hand.

### Handoff

`generate-handoff` renders a session's handoff with plain TypeScript templates
(`server/handoff.ts`) over the session, spec, tickets, their waves (from
`blockedBy`, via `computeWaves`) and the project. No model is called; the same
inputs render the same text. It is stored in `gr_handoffs`, one row per
session, and is readable and editable in the output page's Handoff block.

- `HANDOFF.md` is the entry point for a fresh orchestrating session: the
  session title and idea, the spec path, the waves (each ticket with its
  ticket file and brief), the verify command, the worktree lifecycle
  (embedded whole, so the target repo needs no rules file), an optional
  "Reviewing a ticket" section, and what to record per ticket. The lifecycle
  is selected by the project's **delivery recipe**: `pull-request` pushes
  each ticket's branch and opens it as a draft pull request, never merged
  until it is ready — the reviewer marks it ready on approval with the
  review switch on, the main session does with it off, and a re-verify that
  fails after the reviewer marked it ready undoes that with
  `gh pr ready --undo`; `local-merge` reaches `main` only through a local
  `git merge`, after telling the building session to set
  `worktree.baseRef: "head"` in the repository's `.claude/settings.json`
  and keep `main` checked out, so each new worktree branches from the
  latest local merge, whether or not the repository has a remote — that
  render never mentions a push, `gh`, a pull request, or `origin`.
  "Reviewing a ticket" appears only when the project's **adversarial
  review** switch is on: it covers the reviewer's inputs (spec, ticket,
  brief and diff, never the builder's report), what to try to break, how
  the verdict is recorded per recipe (a pull-request comment plus
  `gh pr ready`; or, for local merge, reported to the main session, which
  records it itself — a bead comment naming the merge commit and the
  verdict together, or, for a markdown tracker, a `## Review` section
  appended to the ticket file, since the one-line `Status:` line has no room
  for a rejected round's findings — the reviewer itself never touching the
  tracker or the bundle), and the
  same-branch fix loop with its two-round cap. With the switch off, the
  section is absent and the lifecycle text has no review step. Beads
  projects get bead commands (the declared tracker's stored commands when
  present); markdown projects get a `Status:` line per ticket instead.
  Build-record commands, with the session id and ticket numbers filled in,
  appear only when the project logs build records.
- `briefs/NN-slug.md` (the same `NN-slug` as the ticket file) holds the
  ticket text, its blockers, the verify command, the file-boundary and
  git/worktree rules, the report format, and "report, then stop", plus two
  labelled slots for the orchestrator: **File boundaries** and **Codebase
  facts**. Its delivery section varies by delivery recipe the same way
  HANDOFF.md's lifecycle does, and its report section names a separate
  reviewer only when the review switch is on. `get-handoff` always shows the
  two slots empty, as `generate-handoff` wrote them; the exported bundle's
  copy carries the session's grounding, when it has one that actually covers
  the ticket, applied at export time — see "Grounding the briefs" below for
  what fills the two more sections it then gains, **Builds on** and
  **Proved by**, and how staleness and hand edits are handled.
- Bundle paths are stored as `{{BUNDLE}}` and filled in at export from the
  project's visibility flag, without re-checking git: `tracked` gives paths
  relative to the repo root plus a commit-before-delegating step (and a
  push, on the pull-request recipe); `ignored` gives absolute paths into
  the main checkout and tells worktree agents to read the bundle by
  absolute path.

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

### Grounding the briefs

`ground-briefs` fills in what a brief's slots leave to the orchestrator. It
runs a handoff scout over the project at its current commit, through the turn
lock and turn records like every other turn, and stores the accepted result in
`gr_brief_groundings`, one row per session, with the commit it read, the
handoff fingerprint it was made for, the model, when it ran and its turn. It
never edits the handoff itself.

Every result is checked before it is accepted, and one that fails is sent back
with the reasons:

- every citation (`buildsOnFiles`, `facts`, a citation-form `buildsOn`) points
  at real lines of the project, by the same check the project scout uses;
- every ticket of the handoff appears exactly once, and no other;
- every blocker of a ticket has exactly one `buildsOn` entry, and every
  `buildsOn` names a real blocker;
- every `buildsOn` takes exactly one of three forms: a `citation` of code
  that already exists, a `createdPath` the blocker creates, or an
  `editedPath` plus the `symbol` the blocker adds to it (a function, route,
  table or field);
- every path (a file to change, a `createdPath` or `editedPath`, the proving
  test) is relative to the project root and stays inside it;
- no file to change sits inside a `.git` folder;
- a file marked `edit` exists, or is a `create` of one of the ticket's
  blockers, directly or through their own blockers (the blocker lands first,
  so ticket 3 may extend a test file its blocker ticket 1 creates);
- a file marked `create` resolves inside the project root (through symlinks),
  does not exist yet, and is not ignored by git (`git check-ignore`);
- no path is marked `create` by more than one ticket, with paths compared as
  a case-insensitive file system would (NFC, case-folded, no trailing
  slash). The first creator keeps it — the ticket in the earliest wave of
  the Blocked-by graph, then the lowest number. A later creator that the
  first one blocks, directly or transitively, is told to mark it `edit`;
  any other later creator is told to drop it or create a file of its own
  beside it;
- a `buildsOn` on a path to be created names a path that blocker lists as a
  `create`, and one on a path it edits names a path that blocker lists as an
  `edit`;
- a ticket that changes files lists its proving test (`provedBy.testPath`)
  among them, as a `create` or an `edit`.

A ticket may list no files to change, as a spike does; its proving test may
then live anywhere. A handoff with more tickets than one turn can ground, or a
ticket with more blockers than a grounded ticket can name, is refused before
any turn is spent.

These rules live in the rejection check (`reasonsToRefuseHandoffGrounding`),
not the result schema, so breaking one is a refusal the scout retries. The
scout never resumes a conversation, so each retry starts fresh: the request
carries the refused result (`previousResult`), and the retry prompt shows it
and tells the scout to keep every entry the reasons do not name, change only
what they name, and not re-read files for the entries it keeps.
`handoffScoutResultSchema` checks only the shape, since a schema failure is
`malformed-output` and ends the turn. The model is still constrained by a
stricter contract, `handoffScoutContractSchema`, which `jsonSchemaFor` hands
the command line: the citation pattern, and the three `buildsOn` forms as an
`anyOf`. What the contract cannot say, and the server cannot verify, the
prompt states: a dependency's check must fail until the blocker lands.

The grounding is **current** only while the handoff's fingerprint over today's
inputs is the one it was made for and the project's `HEAD` is the commit it
read; `get-brief-grounding` reports `handoff-changed` or `head-moved`
otherwise. Regenerating the handoff does not make an old grounding current
again: ground the briefs again instead.

**Rendering from grounding.** `server/handoff.ts`'s `renderBrief` and
`renderHandoff` take the grounding as an optional argument (a plain
`{ tickets, commitRead, current, staleReason }` shape, not the stored row, so
this module never needs a runtime import of `brief-grounding.ts`) and always
render a brief fresh from it — whether a *stored* brief should be rendered
fresh at all, versus kept exactly as it is, is not this function's concern;
`server/export-bundle.ts` decides that at export time (below). Rendered
fresh:

- **A ticket the grounding covers**, current or stale. For that ticket,
  **File boundaries** lists the files to create, the files to edit (one a
  blocker creates as `` `path` (created by ticket NN) ``), and the
  existing files it builds on, cited; **Codebase facts** lists each cited
  statement. Two new sections appear: **Builds on**, one line per blocker
  naming what this ticket needs from it, where — a citation, "created by
  ticket NN at `<path>`" for a dependency on a path that blocker has not
  created yet, or "ticket NN adds `<symbol>` to `<path>`" for one on what
  that blocker adds to a file it edits — and the check to run first; and
  **Proved by**, the test path to add or extend and the command that proves
  the ticket. With **stale**
  grounding this content sits under one line saying it was grounded at commit
  `<short sha>` for an earlier version of the handoff — tickets or project
  settings, since a setting alone (the delivery recipe, the review switch,
  the verify command) also changes the fingerprint (`handoff-changed`) — or
  that the repository has moved since (`head-moved`).
- **No grounding**, or a ticket the grounding does not cover (a ticket added
  since it ran, or the session has never been grounded): today's two empty
  slots, unchanged.

Only the first case is **grounded**; see "Where grounding is applied" below
for what counts. HANDOFF.md's "Before launching a ticket" step says the
briefs are grounded and to check them, instead of telling the orchestrator to
fill File boundaries and Codebase facts by hand, only once the grounding is
current *and* every brief in the plan is actually grounded — stale grounding,
one brief that fell back to plain slots, or one the hash guard is keeping
(rendered grounded, but never actually written — see "kept" below), keeps
today's fill-the-slots wording, since it would otherwise tell the
orchestrator slots are filled that are not. Whether a brief is kept is
worked out before HANDOFF.md's wording is decided, not after, so a kept
brief can never slip through as "grounded".

**Where grounding is applied: at export, not at generation.** `generate-handoff`
and `update-handoff` are unchanged: the handoff row always stores the plain,
ungrounded (or hand-edited) markdown `renderHandoff` writes with no grounding,
and reading the handoff (`get-handoff`) always shows that stored text —
grounding never touches it. `planExportBundle` (`server/export-bundle.ts`,
shared by `preview-export` and `export-session`) is where grounding actually
reaches a brief's text, at the moment the bundle is built, because grounding
happens after the handoff exists and can go stale on its own. This means an
exported brief (or HANDOFF.md) can read differently from what `get-handoff`
shows even with `editedAt` null and no grounding at all: every eligible text
is re-rendered fresh from today's template at export, so a handoff generated
under an older template shows its original wording in `get-handoff` but the
current wording in the bundle.

For HANDOFF.md and each stored brief, `planExportBundle` first decides
**eligible** — nothing in the handoff has ever been hand-edited (`editedAt`
null: `update-handoff` is the only thing that sets it), or, once something
has, this particular text still equals an ungrounded render of it, the same
one `generate-handoff` would have written — or **ineligible**. Checking
`editedAt` first, before ever comparing text, is what keeps a brief
`generate-handoff` wrote under an earlier template version from losing its
grounding to a wording change alone: its bytes no longer match today's
`renderBrief`, but that mismatch is not an edit. Once `editedAt` is set,
though, the equality check decides eligibility for **every** text, not only
the one actually edited: a brief nobody touched, still sitting under that
older template, becomes ineligible too, the moment anything else in the
handoff is edited, and stays that way until the handoff is regenerated (which
clears `editedAt`). An eligible text is re-rendered fresh, with the session's
grounding; an ineligible one is written exactly as stored, grounding never
touching it.

Eligibility alone is not **grounded**. An eligible brief with no grounding to
apply, or with a grounding that does not cover its ticket, still renders
fresh but with nothing grounded in it — plain slots, same as no grounding at
all. A brief counts as grounded only when it is eligible *and* the session's
grounding (current or stale) has an entry for its ticket. `groundedBriefs`
(on `preview-export` and `export-session`) lists exactly those ticket
numbers; `ungroundedBriefs` lists every other brief this plan writes, as
`{ ticket, reason }` — `edited` (ineligible), `no-grounding` (eligible, the
session has no grounding at all), `not-covered` (eligible, a grounding exists
but has no entry for this ticket), or `kept` (eligible, covered and rendered
grounded, but the file already on disk was hand-edited since the last export,
so the hash guard is keeping it instead of writing that text) — so a brief
the grounding skipped, for any reason, is never invisible. Because
`preview-export` and `export-session` build this same plan, the preview's
listed files, its `groundingState`/`groundingStaleReason` and its
`groundedBriefs`/`ungroundedBriefs` always match what a real export writes.

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
