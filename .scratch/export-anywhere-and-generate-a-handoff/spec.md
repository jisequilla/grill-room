# Export anywhere and generate a handoff

Status: ready-for-agent

## Problem Statement

The path from a confirmed Grill Room session to a running build is unreliable. On the first real run, tickets were generated but never reached disk because generating and exporting are separate steps with no default target. Export refused a folder that did not exist yet. The export target means a project root, but nothing previewed where files would land, so passing a feature folder produced a doubly nested .scratch path. The export folder name was the whole session title slugified. Whether agents could see an export depended on the target repo's git tracking, and the app said nothing about it. And there was no handoff at all: every delegation prompt had to be hand-written with the same boilerplate (file boundaries, verify command, git and worktree rules, sync step, report format) repeated per ticket.

## Solution

Projects are registered once in the app, resolved to their git root, with per-project settings: verify command, export folder, slug pattern, tracker kind, build-record logging, and a visibility flag. Export is an explicit action with a preview of exact paths, missing folders are created, the slug is short and editable, and a post-export visibility report says which files the target repo tracks, ignores, or leaves untracked. A session-level HANDOFF.md and per-ticket delegation briefs are generated from the UI, readable and editable there, and exported into the same single directory as the spec and tickets. Export is disabled until a current handoff exists. Tickets gain an explicit depends-on field so the handoff renders a deterministic wave order.

## User Stories

1. As an operator, I want to register a project once by its git root, so that I never type an export folder per session.
2. As an operator, I want registration to refuse a folder that is not inside a git repository, so that every export has a stable repo identity.
3. As an operator, I want registrations stored in the app database and visible in the UI, so that I can review and edit them without touching config files.
4. As an operator, I want a session to reference a project id, so that the export target is preselected when I reach export.
5. As an operator, I want to register Grill Room's own repo like any other project, so that there is one code path for all targets.
6. As an operator, I want a just recipe that registers a project from the command line with flags for every field, so that I can bootstrap the first project from a fresh checkout or a script.
7. As an operator, I want the CLI recipe to default the root to the current directory's git root, so that registering from inside a repo needs no path.
8. As an operator, I want the CLI recipe and the UI form to share the same validation, so that required fields and checks behave identically in both.
9. As an operator, I want root, verify command, and export directory to be required at registration, so that nothing downstream has to guess them.
10. As an operator, I want every other registration field to have a sensible default, so that registration is quick.
11. As an operator, I want the verify command to be a per-project field, so that every brief cites the right command without retyping.
12. As an operator, I want registration to suggest a verify command detected from the repo's build files, so that I only confirm rather than type it.
13. As an operator, I want each project to have a configurable export folder, so that different repos can use different conventions.
14. As an operator, I want registration to read a declared tracker's tickets_dir and pre-fill the export folder, so that the repo's own convention is respected without a precedence rule.
15. As an operator, I want the export folder re-read from the tracker only on an explicit refresh, so that my configuration does not change under me.
16. As an operator, I want to change the export folder in project configuration at any time, so that a wrong pre-fill is easy to correct.
17. As an operator, I want a per-project slug pattern with placeholders such as sequence, date, and slug, so that folder names can match a repo's numbering scheme.
18. As an operator, I want the slug pattern to default to the plain slug, so that projects without a scheme need no setup.
19. As an operator, I want a short slug auto-proposed from the session title, capped at about four words, so that paths stay readable.
20. As an operator, I want to edit the proposed slug in the export preview, so that an odd proposal is fixed before any file is written.
21. As an operator, I want each project to declare its tracker kind as beads or markdown, so that the handoff never assumes tooling the repo lacks.
22. As an operator, I want a per-project toggle for build-record logging, so that the handoff only instructs it where it applies.
23. As an operator, I want each project to carry a visibility flag stating whether the export directory is tracked or ignored, so that the handoff renders the right instructions.
24. As an operator, I want the visibility flag seeded from git check-ignore at registration, so that the default is correct on day one.
25. As an operator, I want the visibility flag to remain editable, so that whether the bundle is version-controlled stays my decision.
26. As an operator, I want export to be an explicit action rather than automatic, so that I see exact paths before anything is written.
27. As an operator, I want the export preview to list every path that will be written under the project root, so that the nested-folder mistake cannot recur.
28. As an operator, I want export to create missing folders under the project root, so that a fresh export folder does not cause a refusal.
29. As an operator, I want export to follow a declared tracker when the repo has one, so that files land where its agents look.
30. As an operator, I want a tracker declaration to be a front-matter block with fixed keys in the repo's issue-tracker file, so that parsing is deterministic.
31. As an operator, I want a repo without the front-matter block to get the fixed layout, so that export never depends on prose parsing.
32. As an operator, I want an incomplete or invalid tracker block to fall back to the fixed layout with a preview line naming the missing key, so that the choice is visible before writing.
33. As an operator, I want the whole session exported into one directory, so that there is a single place to point an agent at.
34. As an operator, I want HANDOFF.md and the spec at the top of the export directory with tickets and briefs in subfolders, so that the entry point is the first thing seen.
35. As an operator, I want the export to be a complete package of spec, tickets, briefs, and handoff, so that nothing is missing on disk.
36. As an operator, I want export disabled until a current handoff exists, so that no bundle on disk lacks an entry point.
37. As an operator, I want a stale handoff to count as missing for the export gate, so that a wrong wave order never ships.
38. As an operator, I want a post-export visibility report per file stating tracked, ignored, or untracked, so that I know whether agents will see it.
39. As an operator, I want a plain warning when agents will not see the exported files, so that failure five from the first run cannot repeat silently.
40. As an operator, I want the warning to name the exact manual command I would run, so that the remedy is one paste away.
41. As an operator, I want Grill Room to never stage or commit in a target repo, so that it does not cross an ownership line or trip identity hooks.
42. As an operator, I want the visibility report to warn when the project's visibility flag disagrees with the repo's real state, so that I learn when .gitignore has moved under me.
43. As an operator, I want a session-level HANDOFF.md, so that a fresh orchestrating session has one entry point.
44. As an operator, I want the handoff to list the spec path, ticket DAG as waves, verify command, sync-to-local-main rule, and what to record per ticket, so that the orchestrator needs no reconstruction.
45. As an operator, I want one delegation brief per ticket linked from the handoff, so that each delegation is ready to paste.
46. As an operator, I want briefs to fix everything that was identical across the first run's prompts, so that boilerplate is never rewritten.
47. As an operator, I want briefs to leave labelled slots for file boundaries and codebase facts, so that the orchestrating session fills only what varies.
48. As an operator, I want the handoff generated in its own block on the same page as the specs, so that the artifacts sit together.
49. As an operator, I want to read the handoff in the UI, so that I can review it before export.
50. As an operator, I want to generate tickets and handoff together or separately, so that the workflow fits the moment.
51. As an operator, I want to regenerate the handoff alone, so that ticket edits do not force regenerating everything.
52. As an operator, I want a secondary generate-all option, so that a one-click path exists without hiding the individual steps.
53. As an operator, I want the separate generation steps to remain the primary actions, so that each artifact stays visible.
54. As an operator, I want to edit the handoff in the UI, so that the app is the source of truth.
55. As an operator, I want regeneration to overwrite my edits only after a confirm, so that edits are not lost by accident.
56. As an operator, I want any ticket change after generation to mark the handoff stale with a badge, so that I know it no longer matches.
57. As an operator, I want a UI edit after export to mark the export stale, so that I know the disk copy is behind.
58. As an operator, I want re-export to overwrite the disk copy, so that disk always reflects the UI.
59. As an operator, I want the handoff to render tracked-variant instructions, with repo-relative paths and a commit-before-delegating step, when the flag says tracked, so that worktree agents can reach the bundle.
60. As an operator, I want the handoff to render ignored-variant instructions, with absolute paths into the main checkout and a mandatory sync rule, when the flag says ignored, so that agents still find the files.
61. As an operator, I want the handoff rendered from the per-project flag without re-checking at export, so that output is predictable and visible in project config.
62. As an operator, I want bead commands in the handoff only when the project declares beads, so that a markdown-only repo gets no wrong instructions.
63. As an operator, I want a status line per ticket inside HANDOFF.md for markdown-only projects, so that the orchestrator can claim and close work with plain files.
64. As an operator, I want build-record logging instructions only when the toggle is on, so that the template matches the repo.
65. As an operator, I want tickets generated with an explicit depends-on field, so that the DAG is a first-class output.
66. As an operator, I want waves derived by topological sort of depends-on, so that regeneration always yields the same order.
67. As an operator, I want depends-on stored as a structured column and rendered as YAML front-matter in exported tickets, so that the bundle is parseable without the app.
68. As an operator, I want to edit dependencies per ticket in the UI, so that wrong generated edges are fixed where the tickets are.
69. As an operator, I want a cycle check on save with a clear refusal, so that waves stay computable.
70. As an operator, I want export to ship first without the gate and handoff to ship second with the gate, so that the blocking export failures are fixed soonest.
71. As an operator, I want the depends-on schema change to ship with the handoff ticket, so that the export ticket stays limited to the first run's failures.
72. As an orchestrating agent, I want to paste HANDOFF.md into a fresh session and have everything needed to run the waves, so that no context is reconstructed by hand.
73. As a worktree agent, I want the brief to state how to reach the bundle given the repo's tracking state, so that I do not fail on an invisible path.

## Implementation Decisions

- A project registry module stores projects in the app database: root path, name, verify command, export folder, slug pattern, tracker kind (beads or markdown), build-record logging toggle, and visibility flag (tracked or ignored). Root, verify command, and export folder are required; the rest have defaults. Sessions reference a project id.
- Root is resolved with git rev-parse show-toplevel and registration refuses non-git folders. No seeding of the app's own repo; it is registered like any other.
- A CLI just recipe registers projects with flags for every field, root defaulting to the current git root, and shares the validation module with the UI form.
- Git access in target repos is read-only: rev-parse, check-ignore, ls-files, status. The app never stages or commits.
- Verify command detection from build files only suggests a default at registration.
- A declared tracker is a front-matter block with fixed keys (tickets_dir, ticket_format, commands) in the repo's issue-tracker document. Registration reads it once to pre-fill the export folder and slug pattern; re-read only on explicit refresh; values remain editable in project config. Incomplete or invalid blocks fall back to the fixed layout with an explicit preview line naming the missing key. How the repo tracks its tickets afterwards is the repo's concern.
- Slug: auto-proposed from the title, capped at about four words, editable in the export preview, then applied to the project's placeholder pattern (defaulting to plain slug).
- Export is explicit. The preview lists exact paths under the project root; missing folders are created. Everything for a session lands in one directory: HANDOFF.md and spec at the top, tickets and briefs in subfolders.
- Export is disabled until a current handoff exists; stale counts as missing. Generate-all is a secondary option; separate generation steps stay primary.
- After writing, a visibility report classifies each file as tracked, ignored, or untracked via read-only git, warns when agents will not see files, names the exact manual command, and warns when the project's visibility flag disagrees with the observed state.
- The visibility flag is seeded from git check-ignore on the export folder at registration and stays editable. The handoff renders its tracked or ignored variant from the flag without re-checking: tracked yields repo-relative paths and a commit-before-delegating step; ignored yields absolute paths into the main checkout and a mandatory sync-to-local-main rule.
- Handoff artifacts: a session HANDOFF.md (spec path, waves, verify command, sync rule, per-ticket recording instructions, tooling commands per project flags) and one brief per ticket linked from it. Briefs fix the invariant parts (git and worktree rules, sync step, verify command, report format, stop-after-reporting) and leave labelled slots for file boundaries and codebase facts. No repo pre-fill.
- Markdown-only projects get a status line per ticket inside HANDOFF.md instead of bead commands. Build-record instructions appear only when the toggle is on.
- The handoff is generated in its own block on the specs page, readable and editable in the UI; regeneration overwrites after confirm. Ticket changes mark it stale; UI edits after export mark the export stale; re-export overwrites the disk copy.
- Ticket schema gains a depends-on field as a structured column, rendered as YAML front-matter in exported tickets. Waves are a topological sort. Dependencies are editable per ticket with a cycle check on save.
- Delivery: two tickets. Export ships first without the gate; handoff ships second with the gate and the depends-on schema change.

## Testing Decisions

- Good tests exercise external behavior: registry validation outcomes, preview path lists, files written on disk, visibility classifications, gate state, staleness transitions, rendered handoff variants, and wave order. They do not assert on internal structure.
- Registry and validation: required fields, git-root resolution, refusal of non-git folders, shared behavior between CLI recipe and UI form, tracker front-matter pre-fill and fallback with the named missing key.
- Export: preview matches written paths, missing folders created, single-directory layout, slug proposal and pattern application, gate disabled without or with a stale handoff.
- Visibility: per-file tracked, ignored, untracked classification against fixture repos, warning text naming the remedy, flag-versus-reality mismatch warning.
- Handoff: tracked and ignored variants rendered from the flag, tooling sections gated by tracker kind and toggle, status lines for markdown projects, brief invariant parts and labelled slots present, staleness on ticket change and edit-after-export, overwrite on confirm.
- Dependencies: topological wave order is deterministic across regenerations, cycle refusal on save, front-matter present in exported tickets.
- Prior art: follow the existing export and session generation tests in the codebase as the pattern for filesystem-fixture and UI-state tests.

## Out of Scope

- Grill Room staging, committing, or otherwise modifying git state in any target repo.
- Pre-filling brief slots by reading the target repo; slots are left for the orchestrating session.
- Parsing prose tracker documents; only the front-matter block is honored.
- Duplicating tickets into a tracker's own directory or otherwise adapting to how a repo tracks tickets after export.
- Ad-hoc export to unregistered folders.
- Auto-export on ticket generation.
- Automatic seeding of the app's own repo as a project.
- Slot-aware merge of handoff edits on regeneration; regeneration overwrites after confirm.
- Detecting the visibility state at export time to change handoff rendering; the flag governs, with a mismatch warning only.

## Further Notes

- The tracked-variant handoff relies on the operator committing the bundle before delegating, since the app never commits; the handoff states this step explicitly.
- Regenerating the handoff after ticket edits is expected to be frequent under the stale-counts-as-missing rule; the separate regenerate-handoff action exists to keep that cheap.