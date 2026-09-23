# 04 Explicit export with path preview, slug, folder creation and single-directory bundle

Status: ready-for-agent
Blocked by: 01, 02

Replace the free-folder export with project-based export. The export dialog preselects the session's project, auto-proposes a slug from the title capped at about four words, shows it in an editable field, applies the project's slug pattern (placeholders seq, date, slug), and previews every path that will be written under the project root before writing. Any tracker diagnostic from ticket 2 appears as a line in the preview. On confirm, create missing folders and write the whole session into one directory: spec at the top, tickets in a tickets subfolder, and (once ticket 7 lands) HANDOFF.md at the top and briefs in a briefs subfolder. Re-export overwrites the existing directory. No gate in this ticket.

Judged by: tests that the preview list equals the files written; missing folders are created; a feature subfolder passed as a project root cannot occur because the root comes from the registry; slug proposal and pattern application produce the expected folder name; re-export overwrites.