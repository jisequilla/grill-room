# 03 The six accept and dismiss actions move onto the Proposal module

Status: ready-for-agent
Blocked by: 01, 02
Suggested model: sonnet

## Intent

The three dismiss actions each clear their Proposal a different way, forget it at once, and ignore the turn lock. Accepting a replacement leaves the spec marked current (spec: `.grill-room/proposal/spec.md`). Ticket 01 built `server/proposal.ts` and keeps the stored kind true, and ticket 02 makes the scan store through `propose`. After this ticket each action keeps its own refusals, checks the pending kind is its own, takes the turn lock, and makes one module call.

## What to build

- **Kind check.** Each action reads `pendingProposal(row)` and uses it for its existing "nothing pending" refusal, with the same code, status and message:
  - accept-deferral and dismiss-deferral need kind `deferral` (`no-deferral`, 409);
  - accept-restatement and dismiss-restatement need `restatement` (`no-restatement`, 409);
  - accept-supersession and dismiss-supersession need `answered-by` or `replacement` (`no-supersession`, 409).

  The not-found (404) and `empty-statement` (400) refusals stay where they are.
- **Accepts.** Each accept replaces its Answer change call (and accept-supersession its replaced-branch update) with `accept(row.id, {now})`, passing `statement` for accept-restatement. The restatement notes computation moves to the module in ticket 01, so delete it here. The turn lock stays where ticket gr-5ys.2 put it.
- **Dismisses.** Each dismiss replaces its hand-written update with `dismiss(row.id, {now})`, and gains `failIfTurnInProgress` after every existing refusal. Read the session the way the accepts do:
  - dismiss-deferral: "The interviewer is working on this session. Wait for the turn to finish before dismissing a deferral."
  - dismiss-restatement: "…before dismissing a restatement."
  - dismiss-supersession: "…before dismissing a supersession."
- **Descriptions.** Each dismiss says that the dismissal is remembered for as long as the answer stands, so the interviewer does not offer it again, and that it refuses while a turn is working. accept-supersession's replaced branch says that the decision's other pending Proposals lapse and the spec is marked not current.
- Every action still returns `describeDecisions([updated])[0]`.

## Behaviour (through the actions)

Fixture: decision S, a settled own answer "A", in a `confirmed` session with a current spec. V is a later settled decision, and L is a loose end.

| # | Start | Call | Expected |
|---|---|---|---|
| 1 | S with a pending deferral "later" | dismiss-deferral | S has no Proposal; dismissals `[{kind: "deferral", reason: "later", dismissedAt}]`; no history row; spec still current |
| 2 | S with a pending restatement "A clean", reason "r" | dismiss-restatement | dismissals hold `{kind: "restatement", reason: "r", text: "A clean"}` |
| 3 | L with a pending answered-by by V | dismiss-supersession | dismissals hold `{kind: "answered-by", targetId: V}` |
| 4 | S with a pending replacement by V | dismiss-supersession | dismissals hold `{kind: "replacement", targetId: V}`; S's answer and settledAt unchanged |
| 5 | S with a pending replacement by V, reason "r" | accept-supersession | replacedById V, replacedReason "r"; no Proposal; answer "A" and settledAt kept; no history row; **spec not current** |
| 6 | L with a pending answered-by by V, "B" | accept-supersession | answer "B", kind `own-answer`, settledById V; one history row (unchanged from today) |
| 7 | the start of rows 1, 2 and 3, with the session turn `working` | the matching dismiss | 409 `turn-in-progress` with the message above; nothing changed |
| 8 | session turn `working`; no deferral, restatement or supersession pending | the matching dismiss | the existing `no-deferral`, `no-restatement` or `no-supersession`, not `turn-in-progress` |
| 9 | S with a pending deferral (`proposalKind` `deferral`) | accept-restatement, dismiss-restatement, accept-supersession, dismiss-supersession | each refuses with its own "nothing pending" code |

## Pattern to copy

- **The session read and the lock:** `actions/accept-deferral.ts` since gr-5ys.2.
- **Refusal ahead of the lock:** `actions/accept-deferral.test.ts`, the row 9 tests from gr-5ys.2.

## Acceptance

Each test must fail with the change it covers undone.

1. **Rows 1 to 7.** One test per row (row 7 is three tests) in the action's test file, named "row N: …". `actions/dismiss-supersession.test.ts` was created by ticket 01 (row K3); extend it, and also cover its 404 and `no-supersession` refusals there.
2. **Row 8.** Row 8 passes on today's code, which has no lock, so prove each test by a planted edit instead: move the session read and `failIfTurnInProgress` above that refusal, and the test must fail.
3. **Row 9.** Row 9 passes on today's code for the columns, so prove it by a planted edit: make the kind check accept any pending kind, and the test must fail.
4. **Existing tests pass**, apart from tests that asserted that a dismiss leaves nothing behind, or that a replacement accept leaves the spec current. Name each one changed in the PR body. Keep every refusal test, every return-shape assertion, and every test of another action.

## Files

- `grill-room/actions/accept-deferral.ts`, `accept-restatement.ts`, `accept-supersession.ts`, `dismiss-deferral.ts`, `dismiss-restatement.ts` and `dismiss-supersession.ts`, with their test files.
- `grill-room/AGENTS.md`: the six action rows only.
- Not `server/proposal.ts` or `server/answer-change.ts`. If either needs a change, stop and report.

## Builds on

- `grill-room/server/proposal.ts`: `pendingProposal`, `accept`, `dismiss`.
- `grill-room/server/turn.ts`: `failIfTurnInProgress`.

## Verify

From `grill-room/`, run `pnpm test`, `pnpm typecheck` and `pnpm lint`; all three exit 0. No visible UI change; run `just e2e` anyway, because `e2e/deferral.spec.ts`, `restatement.spec.ts` and `supersession.spec.ts` drive these actions.

## Merge danger

Two-way door.

## Open questions

None.
