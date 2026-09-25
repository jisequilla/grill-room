# Review: the export-by-lifetime bundle

The bundle in `.grill-room/export-by-lifetime-adr/` came from the Grill Room session for gr-0hy (Part 1) and gr-2f9 (Part 2). It was exported at `3bde622` with all 11 briefs grounded. It is kept as a review sample. **Do not build from it**: gr-0hy Part 1 is built from hand-written tickets instead.

The review checked the bundle against Pipe's items (`pipe-export-review.md`) and spot-checked more than 20 brief citations against the repo. Every citation checked said what its brief claimed.

## Pipe's items in this bundle

| Item | Shows here? | Evidence |
|---|---|---|
| 1. Superseded decisions exported as live | Yes | `decisions.md` keeps p1-file-split's "ADR drafts count as durable". Four other entries also keep the "durable" wording, although p2-suggestion-lifecycle made ADR suggestions working files. Nothing links the two decisions. |
| 2. Raw answers passed through | Yes | Three entries record "Not applicable: Grill Room writes no ADR files…" as their Decision. |
| 3. Readiness verdict never re-run | Yes | `intent.md` says "Not judged for this version of the idea" while every ticket is `ready-for-agent`. |
| 4. Repo facts unchecked | Partly | The brief citations hold. `intent.md` cites `schema.ts:1` for a field at `:83`. |
| 5. Verify command assumed | No | `just check` is a real recipe. |
| 6. Brief duplicates ticket | Yes, by design | The owner kept the copy. |
| 7. Build-record commands repeated | Yes | 11 near-identical lines in `HANDOFF.md`. |
| Empty slots | No | Every brief's slots are filled. |
| Open choices passed to the builder | Yes | See below. |
| No story-to-ticket trace | Yes | None of the 62 stories is referenced by a ticket. |
| Non-code blockers outside the waves | Yes | The "Part 1 used on one real export first" gate is in no wave. |
| No sizing against capacity | Yes | There is no critical path statement. |

## Defects not on Pipe's list

| Defect | Bead |
|---|---|
| Brief 01 bounds a repo-wide rename to 9 files; 37 files reference `exportFolder`. Briefs 03 and 04 also miss the callers of what they change. | gr-c0t.10 |
| Part 2 tickets sit in Waves 1 and 3, against the settled gate. Same-wave tickets edit the same files, and two would both take migration v64. | gr-ibp.11 |
| `HANDOFF.md` and `intent.md` restate the idea as first written ("draft ADRs"), which the interview overturned. | gr-ibp.12 |
| `HANDOFF.md`'s process ignores the repo's delegation rules: two at a time instead of three, no pre-flight, no two-lens review, `git worktree remove`. | gr-c0t.11 |

## Choices the tickets leave to builders

These choices are recorded on gr-0hy, to settle before its tickets are written:
- **Ticket 01's migration.** The NOT NULL rename needs a value for existing rows, but ticket 02 is the one that defines the mapping.
- **Which root the tracker's `tickets_dir` fills.**
- **Defaults.** The literal default folders, and what "under docs" means.
- **`{seq}` and `{date}`.** How they resolve across two roots.
- **`lastExportFolder` after the split.** The scout and grounding use it to exclude Grill Room's own `decisions.md`, which moves to the durable root.
- **Tickets 04 and 05.** Their error codes and override shape.
- **"Open".** Which action counts as opening a project or session.
