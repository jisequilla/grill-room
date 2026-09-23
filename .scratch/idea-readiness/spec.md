# Idea readiness before the first round

## Problem Statement

A session created from a process idea ("decide how to evaluate eight repos") produced an unusable first round: the interviewer had nothing to build, so it asked about methodology, and the session was deleted. Nothing between typing an idea and starting the interview says whether the idea is grill-ready, and the idea is read-only once the session exists.

## Evidence

- Session "Evaluate the 8-repo Claude Code roundup" (2026-09-23): first round overwhelming and off-focus; deleted.
- Calibration (docs/spikes/roundup-harvest.md): a one-page judge prompt run with `claude -p` on four past ideas matched the observed outcome of every one. Ready: export-anywhere (7 evidence, 4 unknowns), change-model (7, 5). Not ready: reading-list (0 evidence), roundup (objective is process, 7 unknowns).

## Solution

A readiness turn on a session that has no rounds yet. The interviewer reads the idea and returns: evidence items quoted from it, the single buildable objective or null, whether that objective is process, the expected outcome or null, the unknowns it raises, a verdict (ready / not-ready), and what is missing. The result is stored on the session and shown above the start panel with a badge; the idea is editable in place while the session has no rounds, and editing clears the stored readiness. Starting the interview is never blocked; a not-ready session keeps its badge in the session list.

## Decisions

- Warn, never block: the operator decides, the app reports (same rule as export visibility).
- The judge is one more interviewer request kind (`assess-readiness`) so it shares the turn lock, retries, structured-output schema, docs-folder mode and the fake interviewer.
- Ready requires at least one evidence item, a non-null non-process objective, and at most five unknowns; the schema carries the fields and the server derives nothing beyond validating them.
- No rewritten idea proposal in this version; the judge only names gaps.
- Readiness is stored as JSON on the session with the idea text it judged; a stale result (idea changed) is treated as absent.
- Idea edits are allowed only while the session has zero rounds and no turn working; the title stays editable as today.

## Out of Scope

- Blocking the first round on a not-ready verdict.
- Proposing a rewritten idea.
- Re-judging automatically after an edit (the operator re-runs).
