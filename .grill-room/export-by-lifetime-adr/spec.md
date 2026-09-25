# Export by lifetime + ADR drafts

Status: ready-for-agent

## Problem Statement

Grill Room's export writes one bundle into one project export folder. Durable files that explain the system after it is built (spec, decisions, intent) sit next to working files that go stale the moment the tickets merge (issues, HANDOFF, briefs, manifest). Nothing can be deleted after the build without losing something someone still reads, and when the export folder defaults to a scratch location it is often gitignored and invisible to worktrees.

Separately, the architecturally significant decisions made during a grilling session have no path into the repo's architecture decision records. On ngine-monitor the read model, liveness, labels and benchmark semantics decisions had to be rewritten into an ADR from scratch by a ticket, after the fact, and bundled in a way that made later partial supersession awkward.

## Solution

Split the export by lifetime. Each project configures two repo-relative roots: a durable root (default under the repo's docs folder) that receives spec, decisions and intent, and a working root (default a tracked `.grill-room` folder) that receives issues, HANDOFF, briefs, ADR suggestions and the manifest. Both roots share one session slug, each keeps its own manifest, and the working half can be deleted after the build with nothing lost. Export refuses if the durable root is gitignored and warns if the working root is.

Mark decisions ADR-worthy during the interview, with the interviewer proposing the flag and writing the consequences at the moment the judgement is freshest. Export renders one ADR-shaped suggestion file per ADR-worthy decision into the working root, generates a final ticket to record the ADRs in the repo's own convention, and tells the builder what that convention is. Grill Room never writes into the repo's decisions folder and never allocates ADR numbers; the repo's own ADR is the only durable record once written, and decisions.md keeps the mark, the amends target and the consequences so the durable record is complete even if the ADR is never written.

Delivery is in two parts: the lifetime split first, used on at least one real export, then the ADR suggestions on top.

## User Stories

1. As a project owner, I want durable export files to land in my repo's docs folder, so that the spec, decisions and intent live where people read documentation.
2. As a project owner, I want working export files to land in a tracked `.grill-room` folder, so that tickets and briefs are visible to every worktree without polluting docs.
3. As a project owner, I want to delete the working folder after the build, so that stale tickets and handoff notes do not linger once the work has merged.
4. As a project owner, I want deleting the working folder to lose nothing anyone still reads, so that cleanup is safe by construction.
5. As a project owner, I want to configure both the durable and working roots explicitly, so that the export matches my repo's layout.
6. As a project owner, I want the two roots named by lifetime rather than by default path, so that I cannot confuse them with the read-only docs folder a session can read from.
7. As a project owner, I want validation to refuse two roots that are the same folder or nested inside one another, so that durable and working files can never collapse into one place.
8. As an existing project owner, I want my current export folder migrated sensibly, so that I do not have to reconfigure every project by hand.
9. As an existing project owner whose export folder is already under docs, I want it to become the durable root and the working root to default to `.grill-room`, so that my documentation stays where it is.
10. As an existing project owner whose export folder is a scratch location, I want it to become the working root and the durable root to default to the docs specs folder, so that durable files move out of scratch.
11. As a project owner, I want the visibility check re-run on both roots when a migrated project is next opened, so that a gitignored docs folder is caught before the first write.
12. As a project owner, I want export to refuse when the durable root is gitignored, so that durable documentation is never silently hidden.
13. As a project owner, I want export to warn, not refuse, when the working root is gitignored, so that a deliberate choice to keep working files out of git remains possible.
14. As a session owner, I want both roots to use the same session slug as the leaf folder, so that I can find the working half of any spec by name.
15. As a session owner, I want each root to keep its own manifest, so that the durable hash record survives after the working folder is deleted.
16. As a session owner, I want the edited-file guard to protect hand edits in each root independently, so that a re-export never overwrites a durable file I changed.
17. As a builder, I want HANDOFF and briefs to reference durable files with repo-root-relative paths, so that links keep working from any worktree and after the working folder moves or is deleted.
18. As a builder, I want the spec to reference tickets with repo-root-relative paths, so that the two halves point at each other reliably.
19. As a project owner, I want Grill Room to notice when the working folder is gone and mark the session's export as retired, so that the app reflects the real state of the repo without deleting anything itself.
20. As a project owner, I want cleanup to be a manual repo commit rather than a Grill Room action, so that the tool never deletes files in my repository.
21. As a session owner, I want re-export after retirement to refuse by default with a clear message, so that a stale session cannot resurrect tickets that already merged.
22. As a session owner, I want an explicit override that recreates the working folder and clears the retired mark, so that a genuinely reopened session can export again.
23. As a session owner, I want the interviewer to propose whether each decision it asks is ADR-worthy, so that the judgement is made while the reasoning is fresh.
24. As a session owner, I want to flip the ADR-worthy flag on any settled decision, so that I keep the final say.
25. As a session owner, I want the scout to propose the ADR-worthy flag on repo decisions it recovers, so that an existing ADR being superseded can be recorded.
26. As a session owner, I want decisions I add myself to default to unmarked with the toggle available, so that nothing is promoted without my judgement.
27. As a session owner, I want the interviewer to write the consequences of an ADR-worthy decision when it proposes the flag, so that the consequences section is a real judgement rather than a restated rationale.
28. As a session owner, I want to edit the stored consequences, so that the record says what I mean.
29. As a session owner, I want one ADR suggestion per ADR-worthy decision, so that each record can be superseded or amended on its own.
30. As a session owner, I want thin ADRs avoided by not marking children that are not costly to reverse on their own, so that the record is about significance, not tree structure.
31. As a session owner, I want issues to carry the decision keys they implement, so that the link between a ticket and the decision it serves is exact and checkable.
32. As a builder, I want each ADR suggestion to list the tickets that implement its decision, so that I know when the decision becomes real.
33. As a builder, I want each ticket to reference the decisions it implements, so that I know which ADR a piece of work serves.
34. As a session owner, I want a warning when an ADR-worthy decision has no implementing ticket, so that an important decision does not go unbuilt unnoticed.
35. As a session owner, I want export to proceed with an empty tickets list in that case, so that a decision that is a record rather than work does not block the export.
36. As a session owner, I want issues with no decision keys to be accepted without warning, so that delivery work is not forced to cite a decision.
37. As a builder, I want ADR suggestions written as one file per decision in the working root, so that recording an ADR is a copy, a rename and a status flip rather than writing from scratch.
38. As a builder, I want each suggestion to carry Status, Context, Decision, Alternatives, Consequences, Tickets and Amends sections, so that it already has the shape of an ADR.
39. As a builder, I want the Context section drawn from the question and its evidence, so that the ADR explains why the decision was needed.
40. As a builder, I want the Decision section drawn from the accepted answer, so that the ADR states what was chosen.
41. As a builder, I want the Alternatives section drawn from the unchosen options and any superseded answers, so that the ADR records what was rejected and why.
42. As a builder, I want an Amends line when a decision supersedes a repo decision cited from an existing ADR, so that the new record names the one it changes.
43. As a project owner, I want Grill Room never to edit an existing repo ADR, so that accepted records are only touched by acceptance in the repo.
44. As a project owner, I want Grill Room never to write into the repo's decisions folder, so that the tool does not own a folder it did not create.
45. As a project owner, I want Grill Room never to allocate ADR numbers, so that two sessions or a concurrent human ADR cannot collide.
46. As a builder, I want the suggestions folder named to say it holds suggestions, so that nobody mistakes it for the real decision record.
47. As a builder, I want the scout to detect the repo's decisions folder, numbering pattern and template, so that I can write the ADR without exploring.
48. As a builder, I want HANDOFF to state the detected convention and a next-free-number hint, so that recording an ADR needs no research.
49. As a builder, I want the convention stated as a hint I can override, so that a wrong heuristic guess does not force a wrong ADR.
50. As a builder, I want HANDOFF to say when no ADR convention was found, so that I ask the repo owner where ADRs belong instead of inventing a layout.
51. As a project owner, I want Grill Room not to create a decisions folder or README in my repo, so that documentation layout stays my call.
52. As a builder, I want export to generate one final ticket to record the ADRs from the suggestions, so that the work is tracked rather than an untracked instruction.
53. As a builder, I want that ticket to be self-contained, listing the suggestion files, the convention hint, the Amends targets and a done condition, so that I can execute it without reading HANDOFF.
54. As a reviewer, I want the ADR ticket's done condition to be that every listed suggestion has a corresponding ADR in the repo folder, so that closure is checkable.
55. As a project owner, I want HANDOFF to state that the ADR ticket must close before the working folder is deleted, so that suggestions are not lost before they are recorded.
56. As a documentation reader, I want decisions.md to mark each ADR-worthy entry, so that I can see which decisions were promoted.
57. As a documentation reader, I want decisions.md to show the Amends target of a marked entry, so that the durable record names what it changes.
58. As a documentation reader, I want decisions.md to render the consequences of each ADR-worthy entry, so that the judgement survives even if the ADR ticket is skipped.
59. As a documentation reader, I want decisions.md to carry no path to a suggestion or a repo ADR, so that the durable record never holds a link that Grill Room cannot keep true.
60. As a session owner, I want decisions.md to remain the full durable record of all decisions, so that product and delivery decisions that are not ADR-worthy still have a home.
61. As a maintainer, I want the lifetime split delivered and used on a real export before ADR suggestions are built, so that the two-root machinery is proven before it is relied on.
62. As a maintainer, I want the export plan to remain the single source of truth for the bundle layout across both roots, so that the guard, gate and visibility checks stay in one code path.

## Implementation Decisions

**Delivery order.** Part 1 (the lifetime split) ships first, is merged, and is used on at least one real export. Part 2 (ADR suggestions) is built on top of it as a separate change.

**Project settings.** The single export folder setting is replaced by two explicit, repo-relative roots named by lifetime: a durable export folder (default the docs specs folder) and a working export folder (default `.grill-room`). The existing field is renamed, not kept alongside. Both are validated identically, and validation refuses roots that are equal or nested one inside the other. The names deliberately avoid the word "docs" so they cannot be confused with the session-level read-only docs folder.

**Migration.** Existing projects are migrated by where their export folder points. If it sits under the docs folder it becomes the durable root and the working root takes its default; otherwise it becomes the working root and the durable root takes its default. The visibility check is re-run on both roots when the project is next opened.

**File split.** Durable: spec, decisions, intent. Working: issues, HANDOFF, briefs, ADR suggestions, manifest. The working half can be deleted after the build without loss.

**Shared slug.** One session slug, computed once, is the leaf folder under both roots.

**Manifests and guard.** Each root keeps its own manifest. The edited-file guard, export gate and containment checks run per root using that root's manifest, so the durable hash record outlives the working folder.

**Visibility policy.** Export refuses when the durable root is gitignored and warns when the working root is. Post-export visibility classification is extended to cover paths under both roots.

**Cross-root paths.** All links between the two halves are repo-root-relative.

**Cleanup and retirement.** Deleting the working folder is a manual repo commit. On next open, Grill Room detects the missing working root and marks the session's export as retired. Re-export of a retired session refuses by default with a clear message; an explicit override recreates the working folder and clears the retired mark.

**ADR-worthy flag.** A new field on decisions marks ADR-worthiness. The interviewer proposes it on decisions it asks, the scout proposes it on repo decisions, user-added decisions default to unmarked. The user can toggle it on any settled decision. Consequences are a new user-editable field on the decision, written by the interviewer at the moment it proposes the flag.

**Granularity.** One suggestion per ADR-worthy decision. Bundling is never done.

**Ticket links.** Issues gain a list of decision keys they implement. Export derives the suggestion's Tickets section and the ticket's decision references from it. An ADR-worthy decision with no implementing ticket produces a warning and an empty Tickets section; issues with no keys are fine.

**Suggestions, not drafts.** Grill Room writes no ADR files, allocates no numbers, and keeps no record of repo ADRs. It renders one ADR-shaped suggestion per ADR-worthy decision into a suggestions folder under the working root, one file per decision key, in Grill Room's own built-in shape: Status, Context (question and evidence), Decision (accepted answer), Alternatives (unchosen options and superseded answers), Consequences, Tickets, Amends. This shape is used regardless of the repo's convention.

**Amends.** When a decision supersedes a repo decision cited from an existing ADR, the suggestion carries an Amends line derived from that citation. The existing ADR is never edited by Grill Room.

**Convention detection.** The scout is extended beyond folder existence to detect the numbering pattern from existing filenames and the template from an existing file's headings. HANDOFF states folder, pattern, template and a next-free-number hint, all phrased as hints the builder may override. When nothing is found, HANDOFF says so and leaves placement to the repo owner; Grill Room never creates a decisions folder.

**ADR ticket.** Export generates one issue, sequenced last, to record the ADRs. It is self-contained: the list of suggestion files, the convention hint, the Amends targets, and a done condition that every listed suggestion has a corresponding ADR in the repo folder. HANDOFF states that this ticket must close before the working folder is deleted.

**Suggestion lifecycle.** Suggestions die with the working folder. The repo's ADR is the only durable record once written, so no acceptance rule is needed in the guard and no duplicate record exists.

**decisions.md.** Each ADR-worthy entry is marked, shows its Amends target when present, and renders its Consequences. It carries no path to a suggestion file or a repo ADR.

## Testing Decisions

A good test exercises external behaviour: what files an export plans and writes under which root, what the manifests record, what the gate refuses or warns about, and what the rendered Markdown contains. Tests do not assert on internal helpers or intermediate data shapes.

Modules to test:

- Project settings validation: two roots accepted, equal or nested roots refused, lifetime-named fields, no collision with the session docs folder.
- Migration: docs-located export folder becomes durable, scratch-located becomes working, defaults filled, visibility re-checked on both.
- Export plan: correct file-to-root assignment, shared slug under both roots, one manifest per root.
- Edited-file guard and export gate: hand edits protected independently per root; refuse on ignored durable root, warn on ignored working root.
- Cross-root links: repo-root-relative paths in HANDOFF, briefs and spec.
- Retirement: missing working root marks the export retired; re-export refuses; override recreates and clears.
- ADR-worthy flag and consequences: proposal shapes for interviewer, scout and user-added decisions; toggle on settled decisions.
- Ticket links: decision keys on issues; derived Tickets sections; warning and empty list for orphan ADR-worthy decisions; no warning for keyless issues.
- Suggestion rendering: one file per ADR-worthy decision under the working root with all sections; Alternatives from unchosen options and superseded answers; Amends from a superseded repo citation.
- Convention detection: folder, numbering pattern, template and next-free-number hint from a fixture repo; explicit "none found" case.
- Generated ADR ticket: sequenced last, self-contained body, done condition.
- decisions.md rendering: mark, Amends and Consequences on ADR-worthy entries, no paths.

Prior art: the existing export bundle plan tests, edited-file guard and manifest tests, visibility classification tests, scout fact detection tests, and decisions.md rendering and supersession parsing tests are the models to follow.

## Out of Scope

- Grill Room writing ADR files into the repo's decisions folder, in any convention.
- Reserving, allocating or recording ADR numbers.
- Editing an existing repo ADR to note that it has been amended or superseded.
- Tracking acceptance of a repo ADR back into the design tree.
- Creating a decisions folder or README in a repo that has no ADR convention.
- A Grill Room action that deletes the working folder.
- Bundling several decisions into one ADR, or a grouping UI.
- Links from decisions.md to suggestion files or repo ADRs.
- Inferring ticket-to-decision links from spec section text.
- Refusing export when an ADR-worthy decision has no implementing ticket.

## Further Notes

The recurring principle in this design is ownership: Grill Room owns its two roots and nothing else. Everything that would require writing into or tracking files the repo owns (ADRs, numbers, acceptance) was moved to the builder via a suggestion and a ticket. Heuristic convention detection is deliberately framed as a hint so that a wrong guess costs the builder a correction, not a wrong record.

The original idea classified ADR drafts as durable. During the interview the model shifted from drafts to suggestions, and suggestions were reclassified as working files because the repo's own ADR is the durable record. Consequences were then pulled into decisions.md so that the durable half stays complete on its own.