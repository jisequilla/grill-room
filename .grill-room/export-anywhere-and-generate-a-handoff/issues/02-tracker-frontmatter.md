# 02 Declared tracker front-matter: parse, pre-fill at registration, explicit refresh

Status: ready-for-agent
Blocked by: 01

Read a front-matter block with fixed keys (tickets_dir, ticket_format, commands) from the repo's docs/agents issue-tracker document at registration. When present and valid, pre-fill the project's export folder from tickets_dir and the slug pattern from ticket_format. Store the values once; re-read only on an explicit refresh action in project config; values remain editable. Prose-only or absent files are treated as no tracker. An incomplete or invalid block records a diagnostic naming the missing or invalid key so the export preview can show it, and leaves the fixed defaults in place. Commands are stored for the handoff to cite later.

Judged by: tests with fixture repos for a valid block, a missing file, a prose-only file, a block missing tickets_dir, and a tickets_dir outside the root; the refresh action updating stored values only when invoked; the diagnostic string surfaced through the project record.