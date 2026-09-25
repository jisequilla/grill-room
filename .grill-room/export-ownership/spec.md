# intent.md, export provenance and the edited-file guard

Status: ready-for-agent

## Problem Statement

Exporting a session writes a bundle into the project: the spec, decisions.md, tickets, a handoff and briefs. Two things go wrong after that.

- **Re-exporting destroys work.** Once the bundle is in the repo, people edit it: they fix a ticket, sharpen the spec, add a note to the handoff. The next export of the same session rewrites every file it plans, silently. The only warning is "Export will replace", which only means the folder already exists. A removal is just as blind: a ticket that no longer exists in the session is deleted even if someone rewrote it by hand.
- **The why never reaches the repo.** The bundle says what to build and how, but not why the feature exists. The idea in the user's own words, the readiness judgment (objective, expected outcome, evidence, unknowns) and what the scout found in the project all stay in the app. A reader of the spec cannot tell what the feature was meant to achieve, or how grounded the session was when it started.

Nothing records where a bundle came from either. The manifest beside the bundle lists paths and nothing else: no session, no export count, no commit.

## Solution

The export gains an `intent.md` and a guard.

- **intent.md** is the why, for people. It is rendered from what the app already stores, never written by the model. It holds the idea verbatim, the readiness objective and expected outcome, the verdict with its evidence, the unknowns, and the scout's current state of the project at the commit it read. What is missing or out of date is stated plainly rather than hidden.
- **The manifest becomes the provenance record.** It names the session, counts exports, records the scout's commit and HEAD at export time, and holds a hash of every file Grill Room wrote. The exported files themselves carry no headers.
- **Edited files are kept.** Before writing, the export compares each file already on disk with the hash it recorded. A file that no longer matches was edited in the repo, and so is a planned file that exists but was never Grill Room's. Both are kept by default, whether the export would overwrite them or remove them. The preview marks each one with a checkbox to overwrite or remove it anyway. Export repeats the check at the moment it writes, so nothing edited after the preview is lost unless the user asked for it.

## User Stories

1. As a session owner, I want exporting a session to also write an intent.md, so that the reason for the feature reaches the repo with the spec.
2. As a reader of the repo, I want intent.md to open with the idea exactly as the user wrote it, so that I read the intent in the user's words and not a rewrite.
3. As a reader, I want intent.md to state the readiness objective and expected outcome, so that I know what the feature is meant to achieve.
4. As a reader, I want the readiness verdict and each evidence item, with whether the user said it or the repo shows it and where, so that I can judge how grounded the session was.
5. As a reader, I want the readiness unknowns listed, so that I know what was open when the interview started.
6. As a reader, I want intent.md to say "not judged for this version of the idea" when the readiness judgment is missing or was made for an earlier idea, so that a stale judgment is never presented as current.
7. As a session owner, I want export never blocked by a missing readiness judgment, so that readiness stays a warning, as it is everywhere else.
8. As a reader, I want intent.md to summarise the scout's current state of the project (built, partial, gap) and name the commit it read, so that I know what already existed when the feature was designed.
9. As a reader, I want intent.md to say when the project has moved since the scout read it, so that I weigh the current state accordingly.
10. As a reader, I want no scout section when the session was never scouted, so that the file claims nothing it does not know.
11. As a reader, I want intent.md rendered from stored data with no model call, so that it states exactly what the session holds.
12. As a maintainer, I want the exported files to carry no provenance headers, so that re-exports do not churn every file and git stays the history.
13. As a maintainer, I want the manifest to record the session id, so that a bundle can be traced to its session.
14. As a maintainer, I want the manifest to count exports, so that I can tell a first export from a later one.
15. As a maintainer, I want the manifest to record the scout's commit and the project's HEAD at export time, so that I know what the session read and what the repo was when the bundle landed.
16. As a maintainer, I want no timestamps in the manifest, so that it changes only when something real changes.
17. As a maintainer, I want the manifest to hold a hash of every file Grill Room wrote, so that a later export can tell whether a file was edited.
18. As a maintainer, I want hashes to ignore line-ending differences, so that git's line-ending settings never make a file look edited.
19. As a session owner, I want a re-export to keep a file edited in the repo by default, so that nobody's work is silently lost.
20. As a session owner, I want a planned file that exists but was never written by Grill Room kept by default, so that a hand-written file in the bundle folder is safe.
21. As a session owner, I want files from an export made before this feature trusted once, so that the first re-export after upgrading does not flag every file.
22. As a session owner, I want a file the new plan drops, but that was edited in the repo, kept by default, so that removals are as safe as writes.
23. As a session owner, I want the preview to mark every edited file it would write or remove, so that I see what will be kept before exporting.
24. As a session owner, I want an "overwrite anyway" or "remove anyway" checkbox on each edited file, unticked by default, so that I choose file by file.
25. As an agent calling the export action, I want to pass the paths to override, so that I can do what the checkboxes do.
26. As a session owner, I want the export result to list the files it kept, so that I know what did not change.
27. As a session owner, I want a kept file to stay in the manifest with the last hash Grill Room wrote, so that later exports keep flagging it and I can still overwrite it.
28. As a session owner, I want the export to check again at the moment it writes, so that a file edited after the preview is kept unless I ticked it.
29. As a developer, I want intent.md and the manifest tested through the export plan, so that their exact content is pinned at one seam.
30. As a developer, I want the guard tested through the export bundle and export action with real temporary folders, so that edits on disk are exercised as they happen.
31. As a developer, I want the smoke test to edit an exported file, see it flagged and kept, then override it, so that the browser path is guarded.

## Implementation Decisions

### intent.md

- Rendered by the export's pure planning step, beside the spec and decisions.md, from stored data: the session's idea and title, the stored readiness judgment and the session's scout report. No model call.
- Sections, in order:
  - the idea, verbatim;
  - readiness: objective, expected outcome, verdict, each evidence item marked as the user's statement or the repo's, with its citation for repo evidence, and the unknowns;
  - the project's current state from the scout report: each built, partial and gap item with its citation, and the commit the report read.
- A readiness judgment counts only when it was made for the current idea (the existing "judged idea equals current idea" rule). Otherwise the readiness section reads "Not judged for this version of the idea."
- A scout report older than the project's HEAD shows its commit and says the project has changed since. A session with no scout report has no scout section.
- intent.md is always planned when a session exports. It is not a decision source: the scout prompt does not name it.

### The manifest

- The existing manifest file beside the bundle keeps its name and gains a new version. It records:
  - the session id;
  - the export revision: the previous manifest's revision plus one, starting at 1. No database column;
  - the scout report's commit, or null;
  - the project's HEAD at export time, or null outside a repository;
  - for every file Grill Room wrote, its path and the sha256 of its content with CRLF normalised to LF.
- No timestamps.
- The previous version (paths only) still parses. Its files are treated as written by Grill Room and unedited, once.

### The guard

- For each planned path that exists on disk, and each path the previous manifest lists that the new plan drops:
  - **unedited**: the previous manifest has its hash and the file on disk matches it, or the previous manifest is the old paths-only version and lists it;
  - **edited**: anything else, including a file the previous manifest never listed.
- Unedited files are written or removed as today. Edited files are kept unless their path is in the override list.
- A kept file stays in the new manifest with the hash Grill Room last wrote for it. A kept file that was never listed is not added to the manifest.
- The preview action returns, for each planned write and removal, whether it is edited. The export action takes an optional list of paths to override, recomputes the classification from disk immediately before writing, and returns the written, removed and kept paths.
- The preview UI shows edited files with an "Overwrite anyway" or "Remove anyway" checkbox, unticked by default, and passes the ticked paths to export. The result lists kept files.
- The existing containment checks still apply to every path, including overrides: an override can never reach outside the bundle.

## Testing Decisions

- Good tests assert what a caller or reader can observe: the planned files and their exact text, the manifest's content, the files on disk after an export, and what the actions return. They never assert on internal helpers.
- **Export plan** (the existing pure seam): intent.md with a current readiness judgment and scout report; with no judgment; with a judgment for an earlier idea; with a stale scout report; with none. The manifest's content: session id, revision numbering from none and from a previous manifest, commits, and hashes that ignore CRLF.
- **Export bundle and the export-session action** (the existing temporary-folder tests):
  - a file edited on disk is kept, listed as kept, and keeps its old hash in the new manifest;
  - with its path in the override list, it is overwritten and gets its new hash;
  - an unlisted file already at a planned path is kept;
  - an old paths-only manifest's files are overwritten once;
  - an edited file the plan drops is kept, and with an override it is removed;
  - a file edited between preview and export is kept;
  - an override path outside the bundle is refused.
- **Browser**: the smoke test, after its first export:
  1. edits `spec.md` on disk;
  2. checks the preview flags it and a re-export keeps it;
  3. ticks its checkbox;
  4. checks the next export overwrites it.

  It also checks that intent.md is written.

## Out of Scope

- A model-written intent. intent.md renders only what the session stores.
- Idea edit history: the app keeps only the current idea.
- The scout reading intent.md.
- Provenance headers inside exported files.
- Merging an edited file with the new version, or writing the new version beside it.
- Handoff scouting, delivery mode and follow-up sessions: features C and E.

## Further Notes

- decisions.md (D1) is covered by the guard like every other file. A kept, edited decisions.md is still what the next scout reads, which is right: the repo's version wins once someone has edited it.
- The design note `docs/design/sdlc-artifact-chain.md` puts provenance in each exported file. This spec moves it into the manifest instead, following the owner's rule that history belongs in git, not in artifacts. The note should say so when this ships.
