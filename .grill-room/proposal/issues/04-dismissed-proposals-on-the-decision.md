# 04 Dismissed Proposals on the decision, and Forget

Status: ready-for-agent
Blocked by: 03
Suggested model: opus

## Intent

Since ticket 03, a dismissed Proposal is remembered and not offered again while the decision's answer stands. The owner chose to see what they dismissed and to be able to forget a dismissal (spec: `.grill-room/proposal/spec.md`, stories 15 to 18). This ticket adds the view field, a `forget-dismissal` action, and a section in the decision detail sheet.

## What to build

- **View.** `DecisionView` (`server/tree.ts`) gains `dismissedProposals`. `describeDecisions` builds it from `dismissals(row)` in `server/proposal.ts`. Each entry is `{kind, targetId, targetTitle, reason, dismissedAt, text}`, in the stored order:
  - `targetId` is null when there is no target;
  - `targetTitle` is the named decision's `questionTitle` when that row is among the rows given, and null otherwise;
  - `text` is null when there is none.

  An empty list is `[]`.
- **Action `forget-dismissal`** (`actions/forget-dismissal.ts`), with schema `{decisionId, kind, targetId?}`. It refuses in this order:
  1. 404 when the decision is not found;
  2. 409 `no-dismissal` ("<title> has no such dismissed proposal.") when no remembered dismissal matches the kind and target;
  3. 409 `turn-in-progress` ("The interviewer is working on this session. Wait for the turn to finish before forgetting a dismissal.").

  It then calls `forgetDismissal(id, {kind, targetId}, {now})` and returns `describeDecisions(sessionRows)` for that decision, so `targetTitle` resolves. The description says what forgetting does: the next scan may offer it again, and nothing else changes.
- **UI.** `app/components/workspace/decision-detail-sheet.tsx` gains a "Dismissed proposals" section, shown only when the list is not empty. It goes after the answer and before history. Each entry shows:
  - the kind, in words: "Answered by <targetTitle>", "Replaced by <targetTitle>", "Deferral" or "Restatement" (when `targetTitle` is null, "a later decision");
  - the reason;
  - the date dismissed;
  - for a restatement, the text turned down.

  Each entry has a Forget button calling `forget-dismissal` through `useActionMutation`, the way `set-adr-worthy` is called in the same file. Strings go through `t()` with keys added beside the existing `workspace.*` keys.

## Behaviour

| # | Start | Action | Expected |
|---|---|---|---|
| 1 | S with remembered dismissals of a deferral ("later", t1) and of a replacement by V | `get-tree` | S's `dismissedProposals` equals `[{kind: "deferral", targetId: null, targetTitle: null, reason: "later", dismissedAt: t1, text: null}, {kind: "replacement", targetId: V, targetTitle: "<V's title>", …}]` |
| 2 | S with no dismissals | `get-tree` | `dismissedProposals: []` |
| 3 | row 1's S | `forget-dismissal {kind: "replacement", targetId: V}` | S's list holds only the deferral; answer, history and spec currency unchanged |
| 4 | row 1's S | `forget-dismissal {kind: "restatement"}` | 409 `no-dismissal`; unchanged |
| 5 | row 1's S, turn `working` | `forget-dismissal {kind: "deferral"}` | 409 `turn-in-progress` |
| 6 | turn `working`, no match | `forget-dismissal {kind: "restatement"}` | 409 `no-dismissal`, not `turn-in-progress` |
| 7 | sheet rendered for row 1's S | | a "Dismissed proposals" section with "Deferral" / "later" and "Replaced by <V's title>"; each entry has a Forget button |
| 8 | sheet rendered for row 2's S | | no "Dismissed proposals" section |
| 9 | e2e: a deferral proposed on a settled answer (fake interviewer) | dismiss it in the deferral proposals card, open the decision | the dismissal is listed; click Forget, and the entry is gone |

## Pattern to copy

- **An action with a refusal before the turn lock:** `actions/accept-deferral.ts` and its row 9 test.
- **A mutation button in the sheet:** the `set-adr-worthy` toggle in `decision-detail-sheet.tsx`, and its component test in `decision-detail-sheet.test.tsx`.
- **The e2e flow up to the deferral card:** `e2e/deferral.spec.ts`.

## Acceptance

1. **Rows 1 and 2** in `server/tree.test.ts` (or the existing `describeDecisions` tests), comparing the whole `dismissedProposals` value with `toEqual`.
2. **Rows 3 to 5** in `actions/forget-dismissal.test.ts`. **Row 6** is proved by a planted edit: move the lock above the `no-dismissal` refusal, and the test must fail.
3. **Rows 7 and 8** in `decision-detail-sheet.test.tsx`.
4. **Row 9** as a new scenario in `e2e/deferral.spec.ts` (or a new `e2e/dismissed-proposals.spec.ts`), so `just e2e` guards it.
5. Check the screens with `agent-browser` against the worktree's own server (a free port, `AUTH_DISABLED`, the fake interviewer and an isolated `DATABASE_URL`), never the user's server on 8082 and never the claude-in-chrome tools. Screenshots: the screenshot subcommand is broken here, so use a one-off playwright-core script (see the bead memory `agent-browser-screenshot-broken`).

## Files

- `grill-room/server/tree.ts`: `DecisionView` and `describeDecisions` only, with their tests.
- `grill-room/actions/forget-dismissal.ts` and `forget-dismissal.test.ts` (new).
- `grill-room/app/components/workspace/decision-detail-sheet.tsx` and its test.
- The i18n strings file that holds the `workspace.*` keys.
- `grill-room/e2e/deferral.spec.ts`, or a new `grill-room/e2e/dismissed-proposals.spec.ts`.
- `grill-room/AGENTS.md`: a `forget-dismissal` row.
- Not `server/proposal.ts`. If it needs a change, stop and report.

## Builds on

- `grill-room/server/proposal.ts`: `dismissals`, `forgetDismissal`.
- The dismiss actions on the module (ticket 03).
- `grill-room/server/turn.ts`: `failIfTurnInProgress`.

## Verify

From `grill-room/`, run `pnpm test`, `pnpm typecheck`, `pnpm lint` and `just e2e`; all exit 0.

## Merge danger

Two-way door.

## Open questions

None.
