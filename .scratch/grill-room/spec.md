# Grill Room

Status: ready-for-agent

## Problem Statement

I use the grilling interview to turn loose ideas into decisions I can commit to. It works, but a chat window is a poor container for it. Each round arrives as a wall of numbered questions that I have to answer in free text, keeping the numbering straight by hand. The design tree the interview is built on exists only in the interviewer's head: I cannot see which decisions are settled, which are askable now, and which are blocked on something else. If I change my mind about an early answer, nothing tells me which later decisions that undermines. I cannot say "I don't know", push back on a bad question, or park a question for later in any way the interview reliably remembers. When the conversation ends or the context fills up, the session is gone; I cannot resume it tomorrow. And the output is whatever I manage to carry out of the chat: there is no spec and no tickets unless I run more steps by hand in the same conversation.

## Solution

Grill Room is a local, single-user app that runs the grilling interview as a structured workspace instead of a chat.

I start a session by describing a loose idea and choosing which Claude model will interview me. The interviewer asks in rounds. Each round is a set of question cards, one per decision, each carrying the interviewer's recommended answer. I work through the cards at my own pace: accept the recommendation, write my own answer, say I don't know, push back on the question, defer it, or flag it as something I need to prototype before I can answer. I can also add a decision the interviewer never asked about. When I submit, the interviewer sees everything together and produces the next round.

Beside the cards I see the design tree: every decision, what it depends on, and whether it is settled, on the frontier, blocked, or stale. The app, not the interviewer, works out those states, and it refuses any round that asks a question whose prerequisites are still open. I can reopen any settled decision; everything downstream is marked stale and the interviewer either reconfirms or re-asks each one.

Sessions are saved as I go and can be resumed at any time. When the frontier is empty the interviewer proposes that we are done and shows me the settled decisions. I must resolve every loose end, then confirm that we have a shared understanding. Only then does the app synthesize a spec, break it into tickets, and let me export both as markdown into a folder of my choice, in the layout my other tools already read. Each ticket carries a small build record where the outcome of building it can be logged.

The app runs entirely on my machine and uses my existing Claude subscription through the Claude Code command-line tool. It needs no API key and no account.

## User Stories

### Sessions

1. As a user, I want to start a new session by typing a loose idea, so that I can begin grilling without preparing anything.
2. As a user, I want to give a session a short title, so that I can tell sessions apart in a list.
3. As a user, I want to choose the interviewer model when I create a session, so that I can spend my best model on the ideas that deserve it.
4. As a user, I want the model picker to default to a global setting, so that I do not have to choose every time.
5. As a user, I want to change the global default model in settings, so that new sessions follow my current preference.
6. As a user, I want each session to record which model interviewed me, so that I can later compare interview quality across models.
7. As a user, I want to see a list of all my sessions with their title, state, and last activity, so that I can find the one I want.
8. As a user, I want to open any session and land exactly where I left it, so that I can resume an interview after closing the app.
9. As a user, I want my draft answers to survive a reload, so that I do not lose work in a half-answered round.
10. As a user, I want to delete a session, so that abandoned ideas do not clutter the list.
11. As a user, I want to see which sessions are in progress, awaiting my confirmation, or finished, so that I know what needs my attention.

### Rounds and question cards

12. As a user, I want each round presented as one card per question, so that I can answer questions individually instead of composing a numbered reply.
13. As a user, I want every card to show the interviewer's recommended answer, so that I can accept a sensible default in one action.
14. As a user, I want to accept the recommended answer with a single action, so that easy questions cost me nothing.
15. As a user, I want to write my own answer in free text, so that I am never limited to the interviewer's options.
16. As a user, I want cards to show the choices the interviewer offered when a question has them, so that I can pick one quickly.
17. As a user, I want to see at a glance which cards in the round I have and have not answered, so that I know when the round is ready to submit.
18. As a user, I want to submit a whole round at once, so that the interviewer sees all my answers together and computes the next frontier, as the grilling method intends.
19. As a user, I want to choose per session to be asked one question at a time instead, so that I can slow the interview down when an idea is delicate.
20. As a user, I want to switch a session between whole-round and one-at-a-time, so that I am not locked into my first choice.
21. As a user, I want to see that the interviewer is working after I submit, so that I know the app has not stalled.
22. As a user, I want a clear error and a retry when the interviewer fails or returns something unusable, so that a bad turn never corrupts my session.
23. As a user, I want to see the history of previous rounds with my answers, so that I can recall why things were decided.
24. As a user, I want later rounds to visibly build on my earlier answers, so that I can trust the interview is progressing.

### Steering moves

25. As a user, I want to answer "I don't know", so that I can be honest instead of guessing.
26. As a user, I want "I don't know" to be treated as a real answer that the interviewer reacts to, so that uncertainty shapes the interview instead of being ignored.
27. As a user, I want to push back on a question with a reason, so that I can reject a wrong premise, the wrong level of detail, or scope drift.
28. As a user, I want a push back to make the interviewer reshape the tree rather than rephrase the same question, so that steering has an effect.
29. As a user, I want to defer a question to a later round, so that I can keep moving without answering it now.
30. As a user, I want everything downstream of a deferred question to stay blocked, so that nothing is decided on top of a gap.
31. As a user, I want to flag a question as needing a prototype, so that questions that cannot be answered by talking stop consuming rounds.
32. As a user, I want a prototype-flagged question to stay paused until I record what the prototype taught me, so that I can come back and answer it in one line.
33. As a user, I want to add my own decision or question to the session, so that things the interviewer missed still enter the tree.
34. As a user, I want the interviewer to place my added decision in the tree with its dependencies, so that it participates in the frontier like any other.

### The design tree

35. As a user, I want to see every decision in the session as a tree, so that I can see the shape of what I am deciding.
36. As a user, I want each decision to show what it depends on, so that I understand why a question is or is not being asked yet.
37. As a user, I want each decision to show its state (settled, frontier, blocked, stale), so that I can read progress at a glance.
38. As a user, I want decisions that are deferred, unknown, or awaiting a prototype to be visibly distinct, so that loose ends stand out.
39. As a user, I want the tree shown as an indented outline with state badges, so that it is readable without any learning curve.
40. As a user, I want to select a decision in the tree and see its question, answer, and history, so that the tree is a way to navigate the session.
41. As a user, I want the tree to update live as the interviewer adds decisions, so that I never have to reload to see the current state.
42. As a user, I want the app to guarantee that no question is asked while something it depends on is still open, so that I am never asked to guess at an answer I have not given yet.
43. As a user, I want the tree states to be computed by the app rather than claimed by the interviewer, so that what I see is always true.

### Reopening decisions

44. As a user, I want to reopen any settled decision, so that changing my mind is a normal part of the interview.
45. As a user, I want every decision downstream of a reopened one to be marked stale, so that I can see what my change puts in doubt.
46. As a user, I want the interviewer to review each stale decision and reconfirm those unaffected, so that I am not re-asked things that still hold.
47. As a user, I want the interviewer to re-ask the stale decisions my change does affect, so that the tree becomes consistent again.
48. As a user, I want the previous answers of reopened and stale decisions kept as history, so that I can see what I used to think.
49. As a user, I want reopening to be possible even after the interviewer proposed we are done, so that a late realisation is not locked out.

### Finishing a session

50. As a user, I want the interviewer to propose that we are done when the frontier is empty, so that the session has a natural end.
51. As a user, I want that proposal to come with a summary of every settled decision, so that I can check the shared understanding before confirming it.
52. As a user, I want the session to stay unconfirmed until I explicitly confirm, so that nothing is acted on without my agreement.
53. As a user, I want to be blocked from confirming while any decision is unknown, deferred, or awaiting a prototype, so that nothing is silently assumed.
54. As a user, I want to resolve each loose end by either answering it or explicitly moving it out of scope or into the notes as a named open question, so that every gap is a deliberate choice.
55. As a user, I want to see the list of loose ends that block confirmation, so that I know exactly what is left.

### Spec

56. As a user, I want the app to synthesize a spec from the settled decisions once I confirm, so that the session produces something I can build from.
57. As a user, I want the spec to follow the sections and rules of the upstream to-spec template exactly, so that it is interchangeable with specs from my other workflows.
58. As a user, I want the spec to contain an extensive list of user stories, so that the coverage of the feature is explicit.
59. As a user, I want the spec to avoid file paths and code snippets, so that it does not go stale.
60. As a user, I want loose ends I moved out of scope to appear in the spec's out of scope section, so that the spec is honest about what it does not cover.
61. As a user, I want loose ends I kept as open questions to appear in the spec's further notes, so that they travel with the spec.
62. As a user, I want to read the spec rendered inside the app, so that I can review it without exporting.
63. As a user, I want to regenerate the spec after reopening and re-settling decisions, so that the spec always reflects the current tree.
64. As a user, I want spec synthesis to skip codebase exploration and test-seam negotiation, so that the app works for ideas that have no code yet.

### Tickets

65. As a user, I want the app to break a finished spec into implementation tickets, so that the work is ready to hand to agents.
66. As a user, I want each ticket to state what blocks it, so that I can tell which tickets can be built in parallel.
67. As a user, I want to see the tickets of a session as a list with their status, so that I can follow the build.
68. As a user, I want tickets sized so that one agent can complete one ticket, so that delegation is straightforward.
69. As a user, I want to regenerate tickets when the spec changes, so that tickets never describe an outdated spec.

### Export

70. As a user, I want to choose a target folder per session, so that each idea's output lands in the project it belongs to.
71. As a user, I want the spec exported as a markdown file under a feature folder in the local-markdown tracker layout, so that my other tools find it where they expect.
72. As a user, I want each ticket exported as its own numbered markdown file with status and blocked-by lines, so that the export matches the upstream ticket convention.
73. As a user, I want the app to tell me exactly which files it wrote, so that I can trust and inspect the export.
74. As a user, I want to be warned before an export overwrites existing files, so that I never lose edits made outside the app.
75. As a user, I want a clear error when the target folder does not exist or is not writable, so that a failed export is never silent.

### Build records

76. As a user, I want each ticket to have a build record, so that the outcome of building it is kept with the ticket.
77. As a user, I want a build record to capture the model that built the ticket, whether the first attempt passed verification, whether it was escalated to a stronger model, and what the delegation prompt was missing, so that I can learn where specs fall short.
78. As an orchestrating agent, I want to write a build record through a command-line or HTTP call, so that I can log results without using the browser.
79. As a user, I want to see build records summarized across a session's tickets, so that I can see first-attempt pass rate and escalations at a glance.
80. As a user, I want to edit a build record, so that I can correct a mistaken entry.

### Running locally

81. As a user, I want the app to work with my Claude subscription through the Claude Code command-line tool, so that I need no API key and pay nothing extra.
82. As a user, I want the app to tell me clearly when the Claude Code tool is missing or not logged in, so that setup problems are obvious.
83. As a user, I want the interviewer to have no ability to run commands, read files, or touch my machine, so that running an interview is safe.
84. As a user, I want the app to bind to localhost with no login screen, so that a single-user local tool has no ceremony.
85. As a user, I want all my data stored in a local embedded database, so that nothing leaves my machine except the calls to Claude.
86. As a user, I want the interviewer to be driven by the original grilling skill text, unmodified, so that the app is a faithful container for the method rather than a reinterpretation.

## Implementation Decisions

### Platform

- The app is built on the agent-native framework, starting from its chat template, in its own subfolder of the repository. The framework is kept as a learning goal; its action model, database layer, live sync, and UI kit are used. Its embedded chat agent is not used, and the template's chat surfaces are removed from the app's navigation and routes.
- Single user, localhost only, the framework's local-dev no-auth mode. Deployment is not a goal.
- Data lives in the framework's embedded Postgres for local development, with the schema defined through the framework's schema helpers and additive migrations only.
- Every app operation is an action. The UI calls actions through the framework's client hooks; the same actions are reachable by HTTP and the framework's action command line, which is how an orchestrating agent writes build records. The UI stays current through the framework's database sync hook.
- Any MCP server needed during development is reached through mcp-cli, not a project-level MCP config. The app itself uses no MCP.

### The interviewer port

- All communication with Claude goes through one narrow module, the interviewer port: a request goes in, a validated structured result comes out. Nothing else in the app knows how Claude is reached.
- The real adapter spawns the Claude Code command-line tool in headless mode once per turn, with every tool disabled, the session's model, a JSON schema constraining the output, and the previous turn's conversation id so the interview continues rather than restarts. This route was chosen after a spike showed the framework's Claude Code harness offers no Fable model, no per-session model selection, slow turns, and host shell access.
- The adapter must clear the environment marker that Claude Code sets for nested sessions, or the spawn fails when the app is started from inside a Claude Code session.
- The session stores the conversation id returned by each turn. If resuming fails, the adapter starts a fresh conversation primed with the session's full decision history, so a lost conversation never loses the interview.
- The interviewer's instructions are the upstream grilling skill text, read verbatim at runtime from a copy installed with the app, plus a short app-specific addendum explaining that output must be a structured proposal rather than formatted chat text, and that fact-finding is unavailable: questions needing facts are put to the user.
- A second adapter, the scripted fake, returns queued results. It is selected by configuration and is used by all tests and the browser smoke test.
- Output that fails schema validation is an error surfaced to the user with a retry, never a partial round.
- The port serves four request kinds: propose the next round, review stale decisions, synthesize the spec, and break the spec into tickets. Each has its own output schema.

### Domain model

- **Session**: title, the original idea, model, answering mode (whole round or one at a time), state (interviewing, done proposed, confirmed), interviewer conversation id, export target folder.
- **Decision**: the node of the design tree. Holds the question title and body, offered choices, recommended answer, the current answer, an answer kind, and the ids of the decisions it depends on. Answer kinds are: accepted recommendation, own answer, unknown, pushed back, deferred, prototype flagged, and dispositioned (moved to out of scope or to open questions). Who introduced the decision (interviewer or user) is recorded.
- **Decision history**: every previous answer of a decision, kept when it is reopened, re-asked, or reconfirmed.
- **Round**: an ordered set of decisions asked together, with its submission state. In one-at-a-time mode a round holds a single decision.
- **Spec**: the synthesized markdown for a session, with a marker for whether it is current with the tree.
- **Ticket**: number, slug, title, body, status, the tickets that block it.
- **Build record**: one per ticket: model, first attempt passed, escalated, what the prompt was missing, free notes.
- Global settings hold the default model.

### Tree state is derived, never stored as truth from the interviewer

- A decision's state is computed by the app from answers and dependency links:
  - **settled**: has a real answer (accepted, own, or dispositioned) and is not stale.
  - **frontier**: not settled, and every decision it depends on is settled.
  - **blocked**: not settled, and at least one decision it depends on is not settled.
  - **stale**: was settled, and a decision it depends on, directly or transitively, was reopened since.
- Unknown, deferred, pushed back, and prototype-flagged decisions are not settled; they hold everything downstream blocked.
- When the interviewer proposes a round, the app validates it before storing it: every proposed question must be on the frontier, dependency links must point at existing decisions, and the links must not form a cycle. A proposal that fails is rejected whole and the interviewer is asked again with the reason; after a bounded number of rejections the user sees an error. The interviewer may introduce new decisions that are blocked, which appear in the tree but not in the round.
- A push back is returned to the interviewer with its reason; the interviewer must respond by withdrawing, replacing, or restructuring the decision, not by re-asking it unchanged. An unchanged re-ask is rejected.
- Reopening a decision clears its settled state, moves its answer to history, and marks all transitive dependents stale. The next turn is a stale review: for each stale decision the interviewer returns either reconfirm (it becomes settled again with its old answer) or re-ask (it rejoins the tree as unsettled with an updated question).

### Finishing

- The interviewer may propose done only when the frontier is empty; the app verifies this itself.
- Confirmation is refused while any decision is unknown, deferred, pushed back, or prototype flagged. Each must be given a real answer or a disposition: out of scope, or named open question.
- Confirmation unlocks spec synthesis. Reopening a decision in a confirmed session returns it to interviewing and marks the spec and tickets as out of date.

### Spec and tickets

- Spec synthesis uses the upstream to-spec template sections and rules verbatim (problem statement, solution, extensive user stories, implementation decisions, testing decisions, out of scope, further notes; no file paths or code snippets). The upstream process is deliberately adapted: no repository exploration and no test-seam check, because sessions have no codebase. Out-of-scope dispositions feed the out of scope section; open-question dispositions feed further notes.
- Ticket breakdown produces tickets sized for one agent each, with explicit blocked-by links validated to reference existing tickets and to be acyclic.
- Export writes the local-markdown tracker layout into the session's target folder: a feature folder named from the session's slug, the spec as one file, and one numbered file per ticket carrying status and blocked-by lines. Export reports the files written, refuses missing or unwritable targets with a clear error, and requires explicit confirmation before overwriting existing files. Export is an action whose server code writes to disk; the interviewer never touches the filesystem.

### Interface

- Three main surfaces: the session list, the session workspace (round cards beside the design tree, with round history), and the session output (spec, tickets, build records, export).
- The design tree's baseline rendering is an indented outline with state badges. Alternative layouts are a later prototyping exercise and are not part of this spec.
- New UI components come from the project's existing component kit.

## Testing Decisions

- A good test here asserts on externally observable behaviour: given a sequence of action calls, what do subsequent action calls return, and what files exist after export. Tests never assert on internal function calls, table layouts, or how the tree computation is organised.
- **One seam for behaviour: the action boundary.** Every behaviour is tested by invoking actions directly, the same entry point the UI, HTTP, and command line use, against a real in-memory instance of the embedded database rather than a mocked store. This covers session lifecycle, round proposal validation and rejection, all steering moves, derived tree states, reopening and stale review, the done gate and dispositions, spec and ticket storage, export to a temporary directory, and build records.
- **One substitution point: the interviewer port.** Action tests run with the scripted fake interviewer, so the suite never calls a real model and is deterministic. Scripts include well-formed rounds, rounds that violate the frontier rule, cyclic dependencies, unchanged re-asks after a push back, and schema-invalid output.
- **One contract test on the real adapter**, with the process spawn stubbed: it asserts what is sent to the command-line tool (all tools disabled, the session's model, the resume id when present, the output schema, the nested-session marker cleared) and that malformed or failed output becomes an error rather than a round. It does not invoke the real tool.
- **One browser smoke test** with Playwright against the running app with the fake interviewer enabled: create a session, answer and submit a round, see the tree update, confirm done, see the spec. Playwright is added to the project for this.
- Real interview quality, spec quality, and ticket quality are judged by the user by hand and are never automated.
- Prior art: the scaffold contains no tests. The framework's own templates place a test file beside each action and call the action's run function directly; this project follows that placement but uses a real in-memory database instead of mocking the store, because the important assertions are about resulting state.
- Every ticket's verification command is the project's test command plus its type check.

## Out of Scope

- Any fact-finding by the interviewer: no reading of local folders or codebases, no web search. Grilling against a codebase with recorded context and decision records is a separate, later feature.
- Multiple users, authentication, sharing, and deployment of any kind.
- Using the framework's embedded chat agent, its Claude Code harness, or any API-key model provider.
- Exposing the app's actions to external agents over MCP.
- Integration with beads or any issue tracker beyond the markdown export. Importing build results automatically from another tool.
- Choosing different models for interviewing, spec synthesis, and ticket breakdown within one session.
- Design tree layouts beyond the indented outline.
- Comparing this grilling method against other interview implementations.
- Editing spec or ticket text inside the app; they are regenerated, or edited after export.
- Automated evaluation of interview quality.

## Further Notes

- This app is also the test subject of a proof of concept about splitting work between models: a top-tier model plans and verifies, cheaper models build from this spec. The proof of concept's own delegation log lives outside the app; the app's build records are a feature for future projects.
- The app, the agents building it, and the orchestrating session all draw on one Claude subscription usage pool. A turn that fails from rate limiting must be reported to the user as such, distinctly from an interviewer error, so it is never mistaken for a defect.
- A headless interviewer turn with structured output was measured at a few seconds; the interface should show progress but needs no streaming.
- The framework is young and moves fast. The installed version is pinned; its bundled, version-matched documentation is the reference, not the public website.
- The framework's setup commands can write a plaintext access token into project files. Nothing in this spec requires those commands; the project's MCP config file and environment file stay out of version control.
- The installed copy of the grilling skill must remain byte-identical to upstream. Behaviour the app needs beyond it belongs in the app-specific addendum, never in the skill text.
