# 02 The scan offers and stores Proposals through the module

Status: ready-for-agent
Blocked by: 01
Suggested model: sonnet

## Intent

The find-superseded scan picks its candidates with filters that disagree about what may be pending, and stores what the interviewer returns as separate writes, with no re-check. A rescan therefore overwrites a pending answered-by or replacement (spec: `.grill-room/proposal/spec.md`). Ticket 01 built `server/proposal.ts`. This ticket makes the scan ask the module who is eligible and store everything through `propose`, in one transaction.

## What to build

- **Candidates.** In `server/supersession.ts`, every candidate list comes from `eligibleFor` in `server/proposal.ts`:
  - the asked loose-end keys from `eligibleFor("answered-by", rows)`;
  - `replaceableKeys` and `laterKeys` from `eligibleFor("replacement", rows)`;
  - `deferrableKeys` from `eligibleFor("deferral", rows)`;
  - `restatableKeys` from `eligibleFor("restatement", rows)`. Today it shares the deferral list; now the two lists differ when a dismissal is remembered.

  `hasAnythingToCheck` uses the same four lists. Delete `supersedableLooseEnds`, `replaceableDecisions` and `deferrableDecisions` from `server/supersession.ts` and import from the module wherever they were used. `laterKeysOf` keeps its rule, over the module's replacement list.
- **Store.** After `keepValidEntries`, the scan stores in one `db.transaction`. Each entry becomes one `propose(id, proposal, {now, db: tx})`:
  - supersessions are `answered-by`, with `byId`, `answer` and `reason`;
  - replacements are `replacement`, with `byId` and `reason`;
  - deferrals are `deferral`, with `reason`;
  - restatements are `restatement`, with `text` = statement, `notes` = operatorNotes, and `reason`.

  A `{stored: false}` result is skipped silently: it is not a failure, and the remaining entries are still stored. Delete the four hand-written update loops.
- **Unchanged:** the prompt's wording, the interviewer contract, the validation reasons, the retry count, `keepValidEntries`, and both entry points (`findSupersessionsForDone`, `runSupersessionTurn`) apart from `hasAnythingToCheck`.

## Behaviour (through `find-superseded`, with the fake interviewer)

Fixture: a session where L is a loose end (`unknown`), and S and S2 are settled own answers settled before V, a settled own answer.

| # | Start | Interviewer returns | Expected |
|---|---|---|---|
| 2 | L holds a pending answered-by by V | (inspect the request) | L's key is not in the asked loose-end keys; L still names V afterwards |
| 3 | S holds a pending replacement by V | (inspect the request) | S's key is not in `replaceableKeys` nor `laterKeys` |
| 4 | S has a remembered deferral dismissal | (inspect the request) | S is not in `deferrableKeys` but is in `restatableKeys` |
| 5 | S has a remembered restatement dismissal | (inspect the request) | S is in `deferrableKeys`, not in `restatableKeys` |
| 6 | S has a remembered replacement dismissal naming V | replacement S by V; deferral S2 | S has no Proposal; S2 holds its deferral; the scan succeeds (no failure stored, no `TurnRejected`) |
| 7 | nothing pending; while the interviewer is answering, S gains a pending deferral | replacement S by V; deferral S2 | S keeps its deferral only (skipped as already pending); S2 holds its deferral; the scan succeeds |
| 8 | nothing pending | deferral S; deferral S2, with the second store made to throw | neither S nor S2 holds a Proposal (one transaction) |
| 9 | every candidate already holds a Proposal | (none) | no `find-superseded` turn record is written and the interviewer is not called |

## Pattern to copy

- The request-inspection and scripted-result tests in `actions/find-superseded.test.ts`. Row 7 needs the fake's `findSuperseded` to make a write before it returns: use the test file's existing hook for a scripted reply if it has one. If not, wrap the fake's method in the test, and say so in the PR body.
- One transaction with `{db: tx}` calls: `actions/submit-round.ts` since ticket gr-5ys.3.

## Acceptance

1. **Rows 2 to 9** (row 1 is ticket 01's K1, which already proves each kind is stored), one test each in `actions/find-superseded.test.ts`, named "row N: …". Each must fail with the change reverted:
   - rows 2 and 3 fail because today's lists include the row;
   - rows 4 to 6 fail because the remembered dismissals are ignored;
   - row 7 fails because today's loop overwrites;
   - row 8 fails because today's writes are separate;
   - row 9 fails because today's `hasAnythingToCheck` counts the pending row.
2. **Through the module.** Planted edit: store one kind with a direct `tx.update` instead of `propose`, and row 6 or row 7 must fail for that kind. Name the kind in the PR body.
3. **Existing tests.** Every existing test in `actions/find-superseded.test.ts` and `actions/request-next-round.test.ts` passes, apart from tests that asserted the old overwrite or the shared deferral/restatement list. Name each one changed, and why, in the PR body.

## Files

- `grill-room/server/supersession.ts`.
- `grill-room/actions/find-superseded.test.ts`.
- `grill-room/AGENTS.md`: the `find-superseded` row only. It gains: a decision already holding a Proposal is not offered again, a remembered dismissal is not offered again, and the scan's Proposals are stored together, skipping any decision no longer eligible.
- Not `server/proposal.ts`, which ticket 01 owns. If it needs a change, stop and report.

## Builds on

- `grill-room/server/proposal.ts`: `eligibleFor`, `propose`, `dismissals`.
- `grill-room/server/supersession.ts`: `scan`, `keepValidEntries`, `hasAnythingToCheck`, `laterKeysOf`.

## Verify

From `grill-room/`, run `pnpm test`, `pnpm typecheck` and `pnpm lint`; all three exit 0. There is no UI change.

## Merge danger

Two-way door.

## Open questions

None.
