# 02 Readiness panel, editable idea, list badge

Status: ready

Build the UI half of idea readiness (see ../spec.md). Depends on 01.

## What to build

1. On the session page, while the session has no rounds: a readiness panel above the start panel (app/components/workspace/turn-panels.tsx area) with an "Assess readiness" action calling `assess-readiness` with a multi-minute timeoutMs (see AGENTS.md on turn-backed actions). While working, show the same working state other turns use. When a result exists, render: verdict badge (ready / not ready), objective (or "No buildable objective found"), a process warning when objectiveIsProcess, evidence list, expected outcome, unknowns with count, and the missing list. Starting the interview stays enabled regardless of verdict.
2. The idea block (app/components/workspace/session-idea.tsx) becomes editable when `canEditIdea` is true: an Edit control opens a textarea, Save calls `update-session-idea`, Cancel discards. After save, the readiness panel shows no result (it was cleared server-side) and invites a re-run.
3. Session list (app/components/sessions/session-list.tsx): a small badge from `readinessVerdict` when non-null; nothing when null.
4. All copy through app/i18n/en-US.ts; controls carry `data-testid` for browser checks; no new dependencies.

## Judged by

- Component tests: panel renders each field from a fixture result; process warning appears only when flagged; edit flow calls the action and hides the result; list badge appears only for judged sessions.
- `pnpm test` and `pnpm typecheck` from grill-room pass.
- Browser check by the main session on the dev server: assess a fresh session, see the verdict, edit the idea, see the result clear, re-assess, start the interview.
