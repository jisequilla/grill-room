# 02 Migrate existing projects to two roots and re-check visibility

Status: ready-for-agent
Blocked by: 01

Add a migration for registered projects. If the existing export folder sits under the docs folder, it becomes the durable root and the working root takes its default; otherwise it becomes the working root and the durable root takes its default. On the project's next open, re-run the git ignore visibility check on both roots and store a visibility flag per root. The migration must never produce equal or nested roots; if the derived pair would violate validation, fall back to defaults for the conflicting root and surface a warning.

Judged by: migration tests for a docs-located folder, a scratch-located folder, and a conflicting case; visibility re-check test showing both flags refreshed on open; existing projects export without manual reconfiguration.