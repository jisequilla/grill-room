# Export a session's decisions as decisions.md

Status: ready-for-agent

## Problem Statement

A grilling session ends with a design tree: every decision, who introduced it, how it was answered, what it depends on, and, for decisions the project had already made, the file and line they came from. The export writes a spec, tickets, a handoff and briefs. It never writes the decisions themselves.

That breaks two things.

- **The record stays in the app.** The spec's decisions section is prose the model wrote from the tree. A teammate or a reviewer reading the repo cannot see exactly what was settled, whether an answer was a one-click default or a deliberate choice, or which of the project's own recorded decisions the feature was built under.
- **The loop never closes.** The project scout reads a project for recorded decisions before the next interview. It looks in ADR folders, the agent instructions and rules files. A session's decisions never land anywhere it looks, so the next session on the same project cannot build on the last one. When an interview overturns one of the project's recorded decisions, nothing in the repo says so, and the next scout proposes the stale statement again.

## Solution

Exporting a session also writes a `decisions.md` beside the spec. It is rendered from the tree, not written by the model, so it records exactly what was settled. It holds three sections:

- **Decisions.** One entry per settled decision the session made, and one per repo decision the interview reopened. Each entry says what was decided, the interviewer's case for it when the answer was one of the offered choices, who introduced it and how it was answered, what it depends on, and, for a reopened repo decision, the source it supersedes.
- **Out of scope.** What the session deliberately set outside the feature.
- **Built under.** The project's own decisions the user kept, as references to their source, never restated.

Loose ends are not decisions and do not appear. They stay in the spec.

Once the export is committed, the next scout on the project reads it. The server hands the scout every `decisions.md` git tracks in the repo, except the file the scouting session itself exported. The scout treats them as recorded decisions. An entry that supersedes a source wins over that source.

## User Stories

1. As a session owner, I want exporting a session to write a decisions.md beside the spec, so that what I decided reaches the repository with the spec.
2. As a session owner, I want decisions.md in the export preview like every other planned file, so that I see it before anything is written.
3. As a session owner, I want decisions.md listed in the export manifest, so that later re-exports own it like the spec and the tickets.
4. As a session owner, I want a re-export that no longer produces decisions.md to remove the copy an earlier export wrote, so that a stale record never lingers.
5. As a session owner, I want no decisions.md when the session settled nothing of its own and set nothing out of scope, so that the repo never collects empty or reference-only decision files.
6. As a reader of the repo, I want one entry per settled decision the session made, so that I see every choice behind the feature.
7. As a reader, I want each entry under a heading with the decision's title, so that I can scan the file.
8. As a reader, I want each entry to state the decision, so that I know what was settled.
9. As a reader, I want the interviewer's case for the chosen option shown and labelled as the interviewer's, so that I understand why without mistaking it for the user's own reasoning.
10. As a reader, I want no "why" on an answer the user typed themselves, so that the file never invents reasoning nobody gave.
11. As a reader, I want each entry to say who introduced the decision, so that I know where the question came from.
12. As a reader, I want each entry to say whether the answer was the accepted recommendation, another offered option, or the user's own answer, so that I can tell a one-click default from a deliberate choice.
13. As a reader, I want origins written as plain phrases rather than internal values, so that the file reads naturally.
14. As a reader, I want each entry's dependencies linked to the entries they depend on, so that I can follow the design tree inside the file.
15. As a reader, I want a dependency on a kept repo decision shown as its key and citation, so that I can find the constraint without the file restating it.
16. As a reader, I want a dependency on a question set aside as a named open question shown by its title and marked as open, so that I know it is not a decision and where to look for it.
17. As a reader, I want entries ordered so that prerequisites come before the decisions that depend on them, so that the file reads as the design unfolds.
18. As a pull-request reviewer, I want re-exporting an unchanged tree to produce the same file, so that diffs show real changes, not reshuffling.
19. As a later scout, I want line citations into decisions.md to stay valid across a re-export that changed nothing, so that references to it keep pointing at the right decision.
20. As a reader, I want a repo decision the interview reopened to appear as a full entry, so that the new answer is recorded.
21. As a reader, I want a reopened repo decision's origin to say it came from the repo, whether it was recorded or inferred, and that it was reopened, so that I see it was deliberately changed.
22. As a reader, I want a reopened repo decision to cite its original source and quote the statement it supersedes, so that I know which of the two wins.
23. As a maintainer, I want the export never to edit the original source of a reopened decision, so that the export only touches files it owns.
24. As a reader, I want the loose ends the session set out of scope listed in their own section, so that the feature's boundaries are recorded.
25. As a reader, I want the project's decisions the user kept listed as references in a "Built under" section, so that I see the constraints the feature was built under.
26. As a later scout, I want kept repo decisions never restated in decisions.md, so that I never find the same decision in two places.
27. As a reader, I want dropped repo decisions left out entirely, so that deliberately set-aside constraints are not presented as decisions.
28. As a later scout, I want open, blocked, stale, deferred, unknown and prototype-flagged decisions left out, and questions set aside as open questions left out, so that nothing in the file can be read as a decision it is not.
29. As a later scout, I want every entry under a stable anchor named by its decision key, so that I can cite it by line and link to it by key.
30. As a later scout, I want the file to open by saying the Grill Room export generated it from a session's settled tree, so that I know what kind of source it is.
31. As a user starting a session on a project, I want the scout to receive every decisions.md git tracks in the project, so that earlier sessions' decisions are grounded evidence.
32. As a user, I want hand-written decisions.md files in the repo included too, so that decisions recorded outside Grill Room count.
33. As a user, I want uncommitted decisions.md files ignored, so that the scout never cites a file its citation check will refuse, and an export counts only once it is accepted into the repo.
34. As a user, I want a session's own exported decisions.md excluded from its own scout, so that a re-scout never offers my own decisions back to me as the project's.
35. As a user, I want the scout told that these files hold recorded decisions, so that it proposes them as recorded, citing the file and line.
36. As a user, I want the scout told that an entry with a Supersedes line wins over the source it supersedes, so that it proposes the new answer, not the overturned statement.
37. As a developer, I want the file's content tested through the export plan, so that one seam covers inclusion, labels, links, ordering and when the file is planned.
38. As a developer, I want the smoke test to show decisions.md in the export preview and written, so that the browser path is guarded.
39. As a maintainer, I want one real round trip on a real project before the feature closes, so that the loop is shown to close with the actual model, not just with prompts that say it should.

## Implementation Decisions

### What decisions.md holds

- It is rendered deterministically from the session's tree by the export's pure planning step, alongside the spec and ticket files. No model call.
- It complements the spec. The spec's model-written decisions prose is unchanged.
- **Decisions section.** A full entry is written for:
  - every settled decision introduced by the interviewer or the user, answered as the accepted recommendation or the user's own answer;
  - every repo decision the interview reopened and settled again.
- **Out of scope section.** Every loose end set aside with the out-of-scope disposition. Each shows its title and the user's note.
- **Built under section.** Every repo decision the user kept (answer kind repo-established): key and citation only. No restated statement, and no anchor.
- **Left out:** decisions in any non-settled state (frontier, blocked, stale, and loose-end answers: unknown, pushed back, deferred, prototype-flagged), questions set aside as open questions, withdrawn and unplaced decisions, dropped repo decisions, question text and rejected choices.

### Entry layout

- The file opens with `# Decisions: <session title>` and one line saying the Grill Room export generated it from the session's settled tree. Provenance metadata (session id, revision, commit) belongs to the export-ownership feature, not here.
- Each Decisions entry is an HTML anchor whose id is the decision key, then a level-three heading with the title, then a field list:
  - **Decision:** the current answer.
  - **Why (interviewer's case):** the rationale of the offered choice whose text equals the answer. Absent when the answer matches no offered choice.
  - **Origin:** the introducer plus how the answer was reached. Interviewer or user, then one of "accepted recommendation", "another offered option" (an own-answer whose text equals an offered choice) or "own answer". A reopened repo decision reads "repo (recorded) · reopened" or "repo (inferred) · reopened".
  - **Depends on:** a link to the anchor of each dependency that is itself an entry. A dependency on a kept repo decision is plain text with its key and citation. A dependency set aside as an open question is plain text: its title and "(open question, see spec)".
  - **Source:** repo-origin entries only, with the original citation.
  - **Supersedes:** reopened repo decisions only, quoting the original repo statement.
- Distinguishing "another offered option" from "own answer" reuses the text match the "why" field needs. No schema change: the answer kind is already stored with every decision.

### Ordering and planning

- Entries are ordered topologically, prerequisites before dependents, with ties broken by decision key. Out of scope and Built under use the same rule. Rendering an unchanged tree twice produces byte-identical text.
- decisions.md is planned only when the Decisions or Out of scope section has at least one item. Built under alone does not plan it. When it is not planned, the existing manifest removal deletes a copy an earlier export wrote, and nothing else.
- It goes through the same preview, containment check, write and manifest as every other planned file, with no special handling in the bundle layer.

### The scout loop

- The project's server facts gain the list of every `decisions.md` git tracks anywhere in the project, found with the read-only git commands already allowed. The list is uncapped and sorted by path. Uncommitted files are excluded, which matches the citation check requiring every cited path to exist at HEAD.
- When facts are collected for a scout, the path the scouting session's own export would write its decisions.md to is excluded.
- The scout prompt lists these files as recorded decision sources, beside the ADR folder, agent instructions and rules files it already names.
- The scout prompt says an entry carrying a Supersedes line overrides the source it quotes: propose the entry's decision, cited to the decisions.md line, and not the superseded statement.

## Testing Decisions

- Good tests assert what a later caller or reader observes: the planned file list and its exact text, the bytes written, the facts collected, and the prompt the adapter sends. They never assert on internal helpers.
- **Export plan** (the pure planning step, the existing seam): trees built for the case, asserting on the planned decisions.md text:
  - an accepted recommendation, another offered option and an own answer each get their origin label, and the why appears only when the answer matches a choice;
  - a user-introduced decision is labelled as the user's;
  - a reopened repo decision shows the reopened label, its source and a Supersedes line;
  - a kept repo decision appears only under Built under, as key and citation;
  - a dropped repo decision, every loose-end state and an open-question disposition appear nowhere;
  - an out-of-scope disposition appears under Out of scope;
  - dependency links go only to entries, with plain-text forms for kept repo decisions and open questions;
  - topological order with key ties, and two renders are byte-identical;
  - the file is planned with one entry or one out-of-scope item, and not planned with only Built under or nothing.
- **Export bundle** (the existing preview and export-session tests): decisions.md appears in the preview, is written and listed in the manifest, and a re-export that no longer plans it removes it and nothing else.
- **Project facts** (the existing temp-git-repo tests): tracked decisions.md files anywhere are listed and sorted; an untracked one is not; the session's own export path is excluded.
- **Scout prompt** (the existing adapter contract test): the prompt names the listed files as recorded sources and carries the Supersedes rule.
- **Browser**: the smoke test's export step asserts decisions.md is in the preview and written with at least one entry.
- **Real round trip** (main session, once): export a real session on a temp copy of a project, commit it, run the scout from a second session, and check it proposes the exported decisions as recorded, cited to decisions.md, and proposes a Supersedes entry over its original source.

## Out of Scope

- intent.md, provenance headers in exported files, and the manifest hash guard that refuses to overwrite files edited in the repo: the export-ownership feature.
- A project-wide decisions log or index across sessions.
- Capturing the user's own reasoning for an answer.
- A new answer kind for "chose another option".
- Editing or flagging the original source of a reopened repo decision.
- Changing the spec's decisions section or the spec synthesis prompt.
- Loose ends and open questions in decisions.md.

## Further Notes

- Grilled in the main conversation, starting from the spec the recorded demo session produced for the same idea. That spec's decisions were made by a replay script and were all reopened; this spec differs from it on loose ends (excluded, not an Unresolved section), tie-breaking (key, not settle order), how kept repo decisions are listed, and in adding the scout loop.
- The design note `docs/design/sdlc-artifact-chain.md` lists decisions.md in the export and relies on the next scout finding it as recorded decisions. This feature makes that true.
- The Supersedes rule is a prompt instruction; only the real round trip shows whether the scout follows it. The same was true of the scout's exclusivity rule.
