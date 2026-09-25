# 02 Provenance manifest and the edited-file guard

Status: ready-for-agent
Blocked by: 01
Suggested model: opus

## What to build

- The manifest's new version, exactly as the spec's "The manifest" section says: session id, export revision, scout commit, HEAD at export, and per-file sha256 with CRLF normalised to LF. The old paths-only version still parses.
- The guard, exactly as the spec's "The guard" section says: classify every planned write and every manifest-driven removal as unedited or edited; keep edited files unless overridden; kept files keep their last hash in the new manifest; unlisted kept files are not added.
- The preview action returns, per planned write and removal, whether it is edited. The export action takes an optional override list, re-classifies from disk just before writing, and returns written, removed and kept paths. Containment applies to overrides.
- No UI: ticket 03 builds the checkboxes.

## Builds on

Ticket 01, the export planner's manifest render and parse, the export bundle's write and `manifestRemovals`, and the preview-export and export-session actions. Confirm they exist first.

## How it will be judged

- Every case in the spec's Testing Decisions "Export bundle and the export-session action" list, plus plan tests for the manifest's content and revision numbering.
- Verification: `pnpm exec vitest --run --maxWorkers=3` and `pnpm typecheck` from `grill-room/`.
