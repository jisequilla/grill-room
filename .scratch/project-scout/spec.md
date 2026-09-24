# Project scout at readiness

Status: ready-for-agent

## Problem Statement

When I grill an idea for an existing project, the interviewer has never seen that project. It reads my idea and my answers, and nothing else, so it designs for a codebase that exists only in its head.

This has now failed twice in the same way. A session for another project exported 86 user stories, a spec and 18 tickets. The stories were good, and about 25 of them shipped nearly verbatim. The design was built for a repo that does not exist:

- Four tickets rebuilt things the project already had.
- The spec named a message broker the project had rejected in a recorded decision.
- It described a service that does not exist, and overturned four recorded decisions without saying so.
- Not one of the 18 tickets could be handed to an agent as written.

The person working in that repo had to rebuild the real picture by hand, with three agents, before anything could be planned.

The second failure was a proposal grilled on Grill Room itself, with docs mode pointed at a spec folder instead of the code. It missed two of the six kinds of turn the app runs, because those lived outside the folder the interviewer could see.

In both cases the interview could only be as grounded as what it could read, and nothing in the flow made it read the project. The readiness check judges only the words of the idea. A statement of the goal can pass as evidence, and nothing says the idea is already half built.

## Solution

When a session has a project, readiness grounds the idea in that project before the interview starts.

First the app collects the facts it can know for certain from the repository itself: the commit it is reading, its remotes, whether it has agent instructions, a decisions folder or rules files, its recent commits, and whether the working tree has uncommitted changes. Then a scout, always running on sonnet, reads the project with read-only access that cannot open secret files. It writes a scout report tied to that commit:

- **Current state:** what already exists relative to this idea, and whether it is built, partial or a gap.
- **Proposed repo decisions:** choices the project has already made that bear on this idea. Each proposal is either recorded (written in an ADR, the agent instructions or a rules file) or inferred (read from code or configuration). Each carries a one-line reason why it matters here.

Every item in the report cites a path and line, and the app checks that each cited file and line exists before it accepts the report. The readiness judge then reads the report alongside the idea. Its evidence now says where each item came from: my idea, or the repo at a cited path.

I review the report in the readiness panel. I keep or drop each proposed repo decision:

- **Kept** decisions enter the design tree as settled decisions marked as coming from the repo, with their citation. The interviewer cannot contradict them. If I want to change one, I reopen it like any other decision, and everything that depends on it goes stale. The spec later lists every repo decision the interview reopened.
- **Dropped** decisions still reach the interviewer as context, but nothing enforces them.

The current state never becomes decisions; it is context for every turn, so the interviewer does not ask about ground that is already settled.

The report stays tied to the commit and the idea it read. When the project's HEAD moves or I edit the idea, the report shows as stale, and nothing happens on its own. When I re-run the scout, it compares its findings with the previous report:

- A kept repo decision the repo no longer supports is reopened, so its dependents go stale.
- New repo decisions arrive as proposals for me to keep or drop.

Sessions without a project keep today's readiness exactly as it is. Readiness still warns and never blocks.

## User Stories

1. As a user grilling an idea for an existing project, I want the app to read the project before the interview starts, so that the interview starts from where the project actually is.
2. As a user, I want grounding to happen during readiness, so that I see what the project already has before I answer a single question.
3. As a user, I want sessions without a project to keep today's readiness unchanged, so that ideas with no codebase are not slowed down.
4. As a user, I want the app itself to collect the facts it can know for certain (the commit, remotes, agent instructions, decisions folder, rules files, recent commits, uncommitted changes), so that those facts never depend on a model's reading.
5. As a user, I want the scout to see those facts before it reads anything, so that it knows where decisions and conventions are likely to live.
6. As a user, I want the scout to always run on sonnet, so that reading files costs what a lookup should cost, whatever model interviews me.
7. As a user, I want the scout's report to record the model it ran on, so that I can see what produced it.
8. As a user comparing interviewer models, I want the session's interviewer model to stay locked to interview turns only, so that the scout does not blur the model comparison.
9. As a user, I want the scout to have read-only access to the project, so that grounding can never change my code.
10. As a user, I want the scout to be unable to open secret files such as environment files, keys and credentials, so that grounding never sends my secrets to a model.
11. As a user, I want the scout to be unable to run commands or reach the network, so that it can only read.
12. As a user, I want the report to list what already exists relative to my idea as built, partial or gap, so that I know how much of the idea is new work.
13. As a user, I want every current-state item to cite where it lives, so that I can check it.
14. As a user, I want the report to propose the project's existing decisions that bear on my idea, so that the interview respects choices already made.
15. As a user, I want each proposed decision labelled recorded or inferred, so that I know how much to trust it.
16. As a user, I want recorded decisions to cite the ADR, agent instructions or rules file and line they come from, so that I can read the original.
17. As a user, I want inferred decisions to cite the code or configuration line they were read from, so that I can confirm the inference.
18. As a user with a project that has no ADRs, I want the scout to infer decisions from code and configuration, so that grounding still works where nothing is written down.
19. As a user, I want each proposed decision to carry a one-line reason why it matters for this idea, so that I can judge relevance quickly.
20. As a user, I want the scout to propose only decisions that bear on this idea, so that my design tree is not flooded with every decision the project ever made.
21. As a user, I want the report bounded in size, so that a large repo produces a readable report.
22. As a user, I want the app to refuse a report that cites a file or line that does not exist, and to ask the scout again, so that invented citations never reach me.
23. As a user, I want the readiness judge to read the scout report, so that it can tell me when my idea is already built or contradicts the project.
24. As a user, I want each evidence item to say whether it came from my idea or from the repo, so that I can tell what I claimed from what the code shows.
25. As a user, I want repo evidence to carry its citation, so that the judge's reasoning is checkable.
26. As a user, I want a restatement of my goal never to count as evidence, so that a one-line idea is not judged ready on its own words.
27. As a user, I want to review the report in the readiness panel, so that grounding happens where I already judge the idea.
28. As a user, I want to keep or drop each proposed repo decision, so that nothing enters my design tree without my say.
29. As a user, I want kept repo decisions to appear in the design tree as settled, so that they constrain the interview from the first round.
30. As a user, I want repo decisions visibly marked as coming from the repo, with recorded or inferred and their citation, so that I can tell them from decisions I made.
31. As a user, I want the interviewer to be unable to ask me to re-decide a kept repo decision, so that it cannot quietly overturn the project's choices.
32. As a user, I want new decisions the interviewer proposes to be able to depend on repo decisions, so that the tree shows what rests on the project's existing choices.
33. As a user, I want to reopen a repo decision like any other settled decision, so that I can deliberately change a project choice.
34. As a user, I want reopening a repo decision to mark its dependents stale, so that everything built on it is reviewed.
35. As a user, I want the spec to list every repo decision the interview reopened, so that overturning a project decision is never silent.
36. As a user, I want dropped repo decisions to still reach the interviewer as context, so that dropping means "not enforced", not "hidden".
37. As a user, I want the current state to reach every interviewer turn as context, so that the interviewer never asks about ground that is already built.
38. As a user, I want the current state to never become decisions, so that the tree stays about choices, not inventory.
39. As a user, I want the report tied to the commit it read, so that I know which version of the project it describes.
40. As a user, I want the report shown as stale when the project's HEAD moves, so that I know it may be out of date.
41. As a user, I want the report shown as stale when I edit the idea, so that the relevance judgments match the idea I am grilling.
42. As a user, I want nothing to happen automatically when the report goes stale, so that I decide when to spend a scout run.
43. As a user, I want to re-run the scout at any point in the session, including after rounds exist, so that a long interview can catch up with a project that moved.
44. As a user, I want a re-run to compare its findings with the previous report, so that I see what changed rather than a fresh list.
45. As a user, I want a kept repo decision that the repo no longer supports to be reopened after a re-run, so that its dependents are reviewed through the stale mechanism I already use.
46. As a user, I want new repo decisions found by a re-run to arrive as proposals, so that I keep or drop them like the first time.
47. As a user, I want repo decisions the re-run still finds unchanged to stay settled untouched, so that a re-run is not noise.
48. As a user, I want the scout to refuse to run while another turn is working on the session, so that two turns never race on one session.
49. As a user, I want the scout's run to be visible in the turn's attempt log, so that a long scout is never a silent wait.
50. As a user, I want a failed scout (rate limit, malformed output, exhausted refusals) to stop with a clear reason and a retry, so that grounding fails the same way every other turn does.
51. As a user, I want to be able to start the interview without a scout report, so that readiness keeps warning and never blocking.
52. As a user, I want the session list to keep showing the readiness badge, so that grounding does not remove what I already rely on.
53. As a user, I want the scout report stored with the session, so that it survives reloads and resuming the session later.
54. As a user, I want a project whose folder is no longer a git repository to produce a clear refusal instead of a scout run, so that I know why grounding cannot happen.
55. As a user with uncommitted changes in the project, I want the report to say the working tree was dirty, so that I know the report may describe code that is not committed.
56. As a second user running Grill Room on my own products, I want grounding to work whatever convention my repo uses for decisions, so that the tool does not assume one project's layout.
57. As a user improving Grill Room, I want the scout's cost and duration recorded per run, so that I can decide how often a scout is worth running.

## Implementation Decisions

### Dependencies

- Builds on turn visibility: the scout is one more turn kind, with its runs and attempts recorded and the model recorded on its turn record.
- Builds on the gr-htk fix: the readiness judge's evidence definition already excludes restatements of the objective.

### Server facts

- Before the scout runs, the server collects facts about the project's repository using the existing read-only git helper and plain file checks. It collects:
  - the HEAD commit and branch
  - the remotes
  - whether the working tree has uncommitted changes
  - the last ten commit subjects
  - which of these exist at the root: agent instructions files, a decisions folder (common names such as `docs/decisions`, `docs/adr`, `adr`) and a rules folder
- These facts are stored in the report as the server collected them. No model derives them.
- A project whose root is no longer a git repository is refused with its own refusal code before any turn starts.

### The scout turn

- A new interviewer request kind, `scout-project`, sharing the turn lock, the retry loop, structured-output validation and the scripted fake with every other kind.
- It runs in a conversation of its own and leaves the session's interviewer conversation untouched, as readiness already does.
- It always runs on sonnet, regardless of the session's interviewer model, and the model lock does not apply to it.
- It uses docs mode's read-only tool set (Read, Glob, Grep) with the project root as the folder, under the same restrictions docs mode already applies: no command-running tools, no network, no project settings, no project MCP servers, no project skills.
- On top of docs mode, it adds deny rules for secret files: environment files (`.env` and `.env.*`), private keys and certificates, and credential files. The deny rules are passed on the command line and enforced by the CLI, not by instruction.
- The request carries: the idea, the title, the server facts, and on a re-run the previous report's kept and proposed repo decisions.

### Scout report schema

- A strict result object:
  - `currentState`: items of `{ status: built | partial | gap, summary, citations[] }`, at most 25.
  - `proposedDecisions`: items of `{ key, title, statement, source: recorded | inferred, citation, reason }`, at most 15. The key is stable across re-runs for the same decision.
  - On a re-run, `previousDecisions`: items of `{ key, change: unchanged | changed | removed, statement? }`, one for every decision in the previous report.
- A citation is a repo-relative path with a line number or line range.
- The app refuses the result and asks again (the existing rejection loop) when:
  - a cited path does not exist at the commit read, or a cited line lies beyond the file's end
  - a proposed decision reuses a key
  - on a re-run, a previous decision is missing from `previousDecisions`

### Storage

- The scout report is stored with the session, holding:
  - the server facts
  - the result
  - the commit and the idea it read
  - the model
  - the time of the run
  - the turn record link
  - the keep or drop state of each proposal
- A report is current only while both the idea and the project's HEAD match what it read. Otherwise it is stale. Staleness is computed on read, like readiness staleness today, and never stored.
- Additive migrations only.

### Readiness with a project

- When a session has a project, asking for readiness runs the scout first if there is no current report, then the judge. The scout and the judge are two turns, each with its own turn record.
- The judge's request gains the current report. Its evidence items become `{ text, source: idea | repo, citation? }`. A repo item must carry a citation, and the app checks it the same way it checks the scout's.
- A readiness judgment made with a report records which report it read. It is stale when that report is stale, in addition to today's rule (the idea changed).
- Without a project, readiness is unchanged.
- Readiness still never blocks starting the interview.

### Repo decisions in the design tree

- Keeping a proposal adds a decision to the tree:
  - introduced by the repo, a new value beside interviewer and user
  - settled, with the statement as its answer
  - with a new answer kind that says it was established by the repo rather than chosen in the interview
  - carrying its source (recorded or inferred), its citation and the report it came from
- Dropping a proposal records the drop in the report. It adds nothing to the tree.
- Keeping and dropping are allowed at any time the session is interviewing and no turn is working.
- Repo decisions are sent to the interviewer as settled decisions with their origin and citation. The existing tree rules already stop a settled decision from being asked again. The instructions tell the interviewer that repo decisions are the project's constraints and that new decisions may depend on them.
- Reopening a repo decision uses the existing reopen. Its dependents go stale and the stale review runs as it does today. Once reopened and answered in the interview, the decision records the interview's answer. It keeps its repo origin and the statement it replaced.
- Spec synthesis receives the list of repo decisions reopened in the interview, each with the repo statement it replaced. The spec states each one as a deliberate change to the project.

### Current state as context

- The current state and the dropped proposals of the session's current report are sent to every interviewer turn as project context. They never become decisions.
- A stale report is still sent, marked stale with its commit, so the interviewer is not left without context.

### Re-scout and drift

- A separate action runs the scout on demand at any time the session is interviewing and no turn is working, including after rounds exist.
- A re-run replaces the current report. Its `previousDecisions` drive the tree:
  - a kept decision reported **changed** or **removed** is reopened, so its dependents go stale; a changed decision's new statement becomes the recommended answer
  - an **unchanged** decision is left untouched
  - new proposals await keep or drop
- A re-run started while the idea has changed since the last report reads the new idea.

### Interface

- The readiness panel shows the scout report:
  - the server facts
  - the current state grouped by built, partial and gap
  - the proposed decisions, with keep and drop controls, source and citation
  - the commit it read, the model, and a stale badge when stale
  - a re-scout control
- The scout's attempt log appears in the panel through the turn-visibility component.
- Repo decisions in the design tree carry a repo marker with recorded or inferred and the citation.
- The readiness panel stays reachable after the first round, so that re-scout and keep or drop remain available during the interview.

## Testing Decisions

- Good tests assert externally observable behaviour: given a project repository, a sequence of action calls and a scripted interviewer, what later action calls return. Tests never assert on internal calls or table layouts.
- **Action boundary (main seam).** Action tests run against the in-memory embedded database with the scripted fake interviewer, as across the project's existing action tests. They also use a real temporary git repository built in the test, as the existing project-registration and visibility tests already do. Cases:
  - Server facts: commit, branch, remotes, dirty state, recent commits and the presence of instructions, decisions and rules are reported as they are in the fixture repo.
  - A project that is not a git repository is refused before any turn.
  - A report citing a missing file or an out-of-range line is refused and asked again; a valid one is stored.
  - Readiness with a project runs scout then judge. Without a project it behaves exactly as before, confirmed by the existing readiness tests passing unchanged.
  - Evidence items carry their source, and repo evidence with an invalid citation is refused.
  - Keeping a proposal adds a settled repo decision that the frontier never offers again. Dropping adds nothing and the proposal still reaches the interviewer as context.
  - Reopening a repo decision marks its dependents stale.
  - The report is stale after a commit lands in the fixture repo, and after an idea edit.
  - A re-run reopens a kept decision reported changed or removed, leaves unchanged ones settled, and adds new proposals.
  - Spec synthesis receives the reopened repo decisions.
  - The scout turn is recorded with the model sonnet, whatever the session's model.
- **CLI contract** (the existing adapter contract test): the scout invocation carries sonnet, the project root as the only added directory, the read-only tool set, docs mode's restrictions and the secret-file deny rules.
- **Components** (the existing readiness panel tests): the report renders facts, the three state groups, proposals with keep and drop, citations, and the stale badge. Repo decisions show their marker in the tree.
- **Browser smoke test**, extended with the fake interviewer scripted to return a report: the panel shows it, keeping a proposal puts a repo decision in the tree, and the first round never asks it.
- **Real CLI checks before closing**, since unit tests stub the process:
  - A secrets probe: a scout run against a temporary repository holding a planted environment file must be unable to read it.
  - A real scout run against a real repository (poc-grill-me itself), whose report is read by the main session. It must cite real paths and propose decisions the repo actually holds.
- Each ticket's verification is the project's test command plus its type check.

## Out of Scope

- The handoff scout that fills briefs' file boundaries, codebase facts and acceptance evidence.
- Delivery mode (pull request or local merge) as a project setting.
- Export ownership: provenance in exported files, the manifest's hash guard, and exporting `intent.md` and `decisions.md`.
- Follow-up sessions opened from a build record or ticket.
- Reading anything outside the project root, such as the user's auto-memory. Lessons that live only there stay unreachable until written into the repo.
- Running the project's tracker commands to read open work.
- Re-running the scout automatically when HEAD moves.
- Blocking the interview on a not-ready verdict or a missing report.
- Giving interview turns access to the project's code. The interviewer reads the report, not the repo.

## Further Notes

- Evidence for the need is recorded in the design note on the SDLC artifact chain: the review of another project's export by the session working in that repo, and issue #11's gaps.
- Whether the deny rules take effect under docs mode's restricted flag has not been verified against the real CLI. The delegation log already records CLI flags that had never met a real prompt as a gap. The secrets probe exists to settle this before the ticket closes.
- The report size limits (25 state items, 15 decisions) are starting values, to be tuned from the attempt log and real reports.
- Confirming an inferred decision is often the first time that decision is written down. Exporting it (in `decisions.md`) belongs to the export-ownership feature, and the next scout will then find it as a recorded decision.
