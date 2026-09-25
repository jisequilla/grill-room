# 09 Detect the repo's ADR convention in the scout

Status: ready-for-agent
Blocked by: none

Extend scout fact detection beyond folder existence. When a decisions folder is found, infer the numbering pattern from existing filenames, the template from an existing file's headings, and a next-free-number hint. Store these as server facts alongside the folder. When nothing is found, record that explicitly. Never create a folder or file in the repo.

Judged by: fixture-based tests for a prefixed numeric convention, a plain numeric convention, a template with headings, and a repo with no decisions folder; a test that detection performs no writes.