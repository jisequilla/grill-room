# Handoff scout: grounded briefs

Status: ready-for-agent

## Problem Statement

A session's handoff gives each ticket a brief, and every brief has the same holes: "File boundaries" and "Codebase facts" are left as slots for a human to fill. Nothing says which test proves the ticket, or what a ticket needs from the tickets it waits on.

When a session for another project was exported, not one of its 18 tickets could be delegated as written. Every brief's slots were empty. In another session, a ticket depended on a table no ticket created, and nothing caught it until the build failed.

So the orchestrating session writes this part of every delegation prompt by hand. It reads the code, lists the files, confirms the helpers exist, and names the test command. That is the most error-prone step in delegation, and nothing records or checks it.

## Solution

A "Ground the briefs" action runs a handoff scout: one read-only model turn over the project at its current commit, covering all the session's tickets at once. For each ticket it fills four parts of the brief:

- **File boundaries:** the files the ticket may create or edit, and the existing files it builds on.
- **Codebase facts:** verified facts about the code the ticket touches, each cited to a file and line.
- **Builds on:** for each ticket this one waits on, exactly what it depends on (a file, a symbol, a table) and the check that proves it exists before work starts.
- **Proved by:** the test file to add or extend, and the command that proves the ticket.

The app checks every claim before accepting it:
- Citations point at real lines.
- Files to create sit inside the project and are not ignored.
- Anything else is refused, and the scout retries.

The result is stored beside the handoff, tied to the commit it read. It shows as out of date when the tickets or the repository change. Hand edits to a brief still win.

Export never waits for grounding. It says whether the briefs are grounded and current.

## User Stories

1. As a session owner, I want a "Ground the briefs" action, so that the briefs are filled from the real code when I choose.
2. As a session owner, I want generating the handoff to stay instant and model-free, so that grounding costs a turn only when I ask for it.
3. As a session owner, I want one scout turn for all tickets, so that it sees how tickets depend on each other.
4. As a session owner, I want the handoff scout to run on sonnet, so that fact-finding follows the same model rule as the project scout.
5. As a building session, I want each brief's file boundaries filled, so that I know what the ticket may touch.
6. As a building session, I want file boundaries split into files to create or edit and existing files it builds on, so that I can confirm the second list exists before starting.
7. As a building session, I want cited codebase facts in each brief, so that I start from verified facts about the code, not from guesses.
8. As a building session, I want each blocked-by edge to name what the ticket depends on and the check that proves it, so that a ticket never starts on a dependency no ticket built.
9. As a building session, I want a "Proved by" part naming the test to add or extend and the command to run, so that I know what evidence finishes the ticket.
10. As a session owner, I want every cited fact, dependency and existing file checked against the repository, so that the briefs cannot cite code that is not there.
11. As a session owner, I want every file to create checked to lie inside the project, not exist yet, and not be git-ignored, so that a brief never plans a file outside the repo or where the repo will not track it.
12. As a session owner, I want a report that fails a check refused and retried, like every other interviewer turn, so that bad grounding never reaches a brief.
13. As a session owner, I want the grounding stored separately from the brief text, so that I can tell the scout's work from my own edits.
14. As a session owner, I want the grounding tied to the handoff and the commit it read, so that I know what it describes.
15. As a session owner, I want the grounding shown as out of date when the tickets or the repository change, so that I never delegate from a stale brief without knowing.
16. As a session owner, I want to re-run grounding whenever I choose, so that I can refresh it after changes.
17. As a session owner, I want my hand edits to a brief to win over the grounding, so that the scout never overwrites my corrections.
18. As a session owner, I want an ungrounded brief to keep today's empty slots, so that nothing changes when I skip grounding.
19. As a session owner, I want the export preview to say whether the briefs are grounded and current, so that I decide knowingly.
20. As a session owner, I want export never blocked by grounding, so that grounding stays advice, like readiness.
21. As a session owner, I want the grounding turn recorded like every other turn (model, attempts, refusals), so that its cost and failures are visible.
22. As an agent, I want grounding available as an action, so that I can do what the button does.
23. As a developer, I want the grounding request covered by the fake interviewer, so that tests and the browser suite can drive it without a model.

## Implementation Decisions

- **The request kind.** A new interviewer request kind for the handoff scout. It follows the project scout's pattern:
  - read-only tools with the project root as the folder, and the same deny rules;
  - its own conversation, always on sonnet;
  - a strict result schema with bounded lists;
  - its own prompt builder, which says the idea, the spec and the tickets define the work and the code defines the facts;
  - a fake scenario.
- **The request carries:** the project's server facts, the spec, and every ticket with its number, title, body and blockers.
- **The result, per ticket number:**
  - `filesToChange`: paths, each marked create or edit;
  - `buildsOnFiles`: citations;
  - `facts`: a statement and a citation;
  - `buildsOn`: one per blocker, with the blocker's number, what it provides, a citation or a path to be created by that blocker, and a check command or test;
  - `provedBy`: the command that proves the ticket, and the test path to add or extend. The test path is null when the spec rules out tests for the ticket's kind of change; the command then proves it on its own.
- **The rejection check** reuses the project scout's citation check for every citation, then adds:
  - Every ticket appears exactly once.
  - Every `buildsOn` entry names a real blocker of that ticket.
  - A file marked edit exists.
  - A file marked create resolves inside the root, does not exist, and is not git-ignored.
  - A dependency on a path to be created must be listed as a create by that blocker.
- **Storage.** A grounding record per session:
  - the accepted result, the commit read, the handoff fingerprint it was made for, the model, the run time and the turn link;
  - replaced on re-run.
  - It is current only while the handoff's fingerprint and the project's HEAD match what it read.
- **Rendering.** The brief renderer fills File boundaries and Codebase facts, and adds "Builds on" and "Proved by" sections, from a current grounding.
  - With stale grounding, the brief still renders it, under a line saying it was grounded at an earlier commit or for earlier tickets.
  - With none, today's slots stay.
  - A brief the user edited keeps its edited text; grounding never rewrites it.
- **The action.** "Ground the briefs" runs through the turn lock and turn records like every other turn. It refuses when:
  - the session has no project;
  - the project is not a repository;
  - there is no handoff or the handoff is stale;
  - a turn is working.
- **Export.** The export preview reports the grounding state: absent, current, or stale with its reason. It never blocks.

## Testing Decisions

- Good tests assert what a caller observes: the prompt the adapter sends, the actions' results and refusals, the stored record, and the rendered brief text.
- **Adapter contract test** (the existing scout pattern): the request kind runs on sonnet, with read-only tools, deny rules and the project root. Its prompt carries the tickets, their blockers and the facts.
- **Action tests** (temp git repo, scripted fake):
  - a valid grounding is stored and read back current;
  - each check refuses and retries: a missing citation, an out-of-range line, an edit of a missing file, a create inside an ignored path, a create outside the root, a create of an existing file, a buildsOn naming a non-blocker, a missing ticket, and a dependency on an uncreated path;
  - the grounding goes stale after a new commit and after a ticket edit;
  - each refusal of the action itself.
- **Brief renderer** (the existing pure tests): exact text with current grounding, with stale grounding, with none, and with an edited brief.
- **Export preview test:** reports absent, current and stale.
- **Browser:** the smoke test grounds the briefs through a fake scenario and asserts a brief shows the filled parts.

## Out of Scope

- Delivery recipes and the review gate: `.grill-room/delivery-recipe/`.
- Copying the project's rules into HANDOFF.md.
- Grounding each ticket in a separate turn.
- Running grounding automatically on handoff generation.
- Blocking export on grounding.

## Further Notes

- This is the step the orchestrating session in this repository has done by hand for every delegated ticket. The briefs' "Builds on" part is the data behind the delegation prompt's "confirm these exist first" step.
- A real run on a real project, like the decisions.md round trip, should confirm the scout's claims hold before this is relied on.
