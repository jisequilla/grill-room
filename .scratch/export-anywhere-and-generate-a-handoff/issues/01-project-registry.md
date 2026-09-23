# 01 Project registry: schema, validation module, UI form, session link

Status: ready-for-agent
Blocked by: none

Build the project registry in the app database with fields: root path, name, verify command, export folder, slug pattern, tracker kind (beads or markdown), build-record logging toggle, visibility flag (tracked or ignored). Root, verify command and export folder are required; the rest default (slug pattern to plain slug, tracker kind markdown, build-record off). Root is resolved via read-only git rev-parse; non-git folders are refused. A single validation module owns required-field checks and git-root resolution and is the only entry point for creating or editing a project. Registration suggests a verify command detected from build files (package.json, justfile, Makefile) as a default only. Seed the visibility flag from git check-ignore on the export folder; it stays editable. Provide a project list and edit form in the UI. Sessions gain a project id reference selectable at session creation and editable later.

Judged by: tests for required fields, refusal of non-git folders, git-root resolution against a fixture repo, verify-command suggestion, visibility flag seeding for an ignored and a tracked folder, and a session persisting its project id. Grill Room's own repo registers through the same path with no special casing.