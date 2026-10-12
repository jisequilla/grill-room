# 01 The Proposal module and its migration

Status: ready-for-agent
Blocked by: none
Suggested model: opus

## Intent

Nothing owns a decision's Proposals (spec: `.grill-room/proposal/spec.md`). The scan stores them, five places clear them, and the rule of what may be pending at once is only a comment. This ticket adds:
- the stored kind;
- the remembered dismissals;
- the **Proposal** module (`grill-room/server/proposal.ts`) with its whole interface;
- seven small edits so that today's writers keep the stored kind true until tickets 02 and 03 move them onto the module.

## What to build

### Migration (version 82, `decisions-proposal-kind-dismissals`)

- The migration adds `gr_decisions.proposal_kind TEXT` and `gr_decisions.dismissed_proposals_json TEXT`. The kind is null when nothing is pending, and otherwise `answered-by`, `replacement`, `deferral` or `restatement`. The dismissals column is null when there are none.
- **What counts as pending** is what the actions test today:
  - a supersession: `superseded_by_id IS NOT NULL AND superseded_by_id <> ''` (the supersession actions test `!row.supersededById`);
  - a deferral: `deferral_reason IS NOT NULL AND deferral_reason <> ''` (dismiss-deferral tests `!row.deferralReason`);
  - a restatement: `restatement_text IS NOT NULL` (the restatement actions test `== null`, so `''` counts).
- **The conflict check.** The entry has a `run(exec)`. The framework's `MigrationEntry.run` runs before the entry's `sql`. It selects, `ORDER BY id` in SQL, the decisions holding more than one pending Proposal. If there are any, it throws an `Error` whose message:
  - names them: "Decisions hold more than one pending proposal: <id>, <id>.";
  - then prints, for each id, one ready-to-run statement per Proposal it holds, so the owner can pick which to clear: `UPDATE gr_decisions SET superseded_by_id = NULL, supersession_answer = NULL, supersession_reason = NULL WHERE id = '<id>';`, `UPDATE gr_decisions SET deferral_reason = NULL WHERE id = '<id>';` and `UPDATE gr_decisions SET restatement_text = NULL, restatement_notes = NULL, restatement_reason = NULL WHERE id = '<id>';`;
  - ends: "Run enough of these to leave at most one proposal on each decision, against the app's database, then restart."

  The columns are then never added.
- **The `sql`** adds both columns (`ADD COLUMN IF NOT EXISTS`) and backfills the kind with the pending tests above:
  - `restatement` where a restatement is pending;
  - `deferral` where a deferral is pending;
  - for a pending supersession, `replacement` when `answer_kind` is one of `SETTLING_ANSWER_KINDS` and `answered-by` otherwise. Build the kind list from the constant (import it from `server/tree.ts`, which imports only types).

  The splitter breaks on every `;` outside single quotes and does not know `$$`, so use plain statements only.
- **`server/db/schema.ts`** gains `proposalKind` and `dismissedProposalsJson`, with doc comments in the style of their neighbours, and the `DecisionProposalKind` type.

### Cleared constants (`server/tree.ts`)

- `CLEARED_SUPERSESSION` and `CLEARED_RESTATEMENT` gain `proposalKind: null`.
- A new `CLEARED_PENDING_PROPOSAL` is `{...CLEARED_SUPERSESSION, deferralReason: null, ...CLEARED_RESTATEMENT}`.
- `CLEARED_PROPOSAL` becomes `{...CLEARED_PENDING_PROPOSAL, dismissedProposalsJson: null}`. Answer change keeps spreading `CLEARED_PROPOSAL`, so every answer change, a reword included, forgets the decision's dismissals with no edit to `server/answer-change.ts`.
- Update the doc comments to say so.

### Keep the kind true until tickets 02 and 03

Today's writers must not leave a stale or missing kind behind:
- `server/supersession.ts`, in `scan`: each of the four store loops also sets `proposalKind`: `answered-by`, `replacement`, `deferral` or `restatement`. Change nothing else in the scan.
- `actions/dismiss-deferral.ts`: its update also sets `proposalKind: null`.
- `actions/dismiss-supersession.ts`: spread `CLEARED_SUPERSESSION` in place of the three hand-written nulls.
- `actions/accept-supersession.ts`, replaced branch: spread `CLEARED_SUPERSESSION` in place of the three hand-written nulls.

`dismiss-restatement` already spreads `CLEARED_RESTATEMENT`, and the accepts that go through Answer change spread `CLEARED_PROPOSAL`, so both now clear the kind with no edit.

### The module (`server/proposal.ts`)

Every function except the three readers (`pendingProposal`, `dismissals`, `eligibleFor`, which are pure) takes `opts: { now: string; db?: DbHandle }`. Without `db`, a function that makes more than one write (the answered-by, deferral and restatement accepts through Answer change, and the replacement accept) opens its own transaction. Every write stamps `updatedAt = opts.now`. Every function taking an id throws `Error("Decision not found: <id>")` for an unknown id, as Answer change does.

- **`pendingProposal(row)`** returns `null` or a tagged value read from `proposalKind`:
  - `{kind: "answered-by", byId, answer, reason}`;
  - `{kind: "replacement", byId, reason}`;
  - `{kind: "deferral", reason}`;
  - `{kind: "restatement", text, notes, reason}`.

  This is the `Proposal` type, and `propose` takes the same type.
- **`dismissals(row)`** returns the parsed remembered dismissals, or `[]` when null. Each is `{kind, targetId?, reason, dismissedAt, text?}`.
- **`eligibleFor(kind, rows)`** returns the rows of one session that may be offered that kind, in the order given. These are today's rules, unchanged, and every one of today's conditions stays:
  - answered-by: `supersedableLooseEnds`;
  - replacement: `replaceableDecisions`;
  - deferral and restatement: `deferrableDecisions`.

  Two exclusions are added:
  - every kind excludes a row with `proposalKind != null`;
  - deferral and restatement each exclude a row with a remembered dismissal of that kind.

  The answered-by and replacement dismissals name a target, so they are matched in `propose`. The three functions in `server/supersession.ts` stay until ticket 02.
- **`propose(id, proposal, opts)`** returns `{stored: true, row}` or `{stored: false, skip}`. It re-reads the session's rows through the handle and checks, in this order:
  1. a pending Proposal on the row gives `"already-pending"`;
  2. a remembered dismissal of the same kind, and for answered-by and replacement with `targetId` equal to `byId`, gives `"dismissed"`;
  3. a row not in `eligibleFor(kind, rows)` gives `"not-eligible"`.

  Otherwise it writes `proposalKind` and that kind's payload columns in one update. There is no write guard: concurrent writers are kept apart by the actions' turn lock and the scan's transaction, not here.
- **`accept(id, opts & {statement?})`** returns the updated row, or `null` with no write when nothing is pending:
  - answered-by: `settle(id, {answer: supersessionAnswer ?? "", kind: "own-answer", settledById: supersededById}, {now, reason: supersessionReason ?? undefined, db})`.
  - replacement: one update setting `replacedById = supersededById`, `replacedReason = supersessionReason` and `...CLEARED_PENDING_PROPOSAL`, then `markSpecNotCurrent`, both on one handle (its own transaction without `db`). It writes no history and keeps the answer, `settledAt` and the dismissals. It does not go through Answer change.
  - deferral: `defer(id, {now, reason: deferralReason ?? undefined, db})`.
  - restatement: `reword(id, {text: statement?.trim() || restatementText, notes}, {now, reason: restatementReason ?? undefined, db})`. `notes` is computed exactly as `actions/accept-restatement.ts` computes it today (copy the computation here; ticket 03 deletes the action's copy).
- **`dismiss(id, opts)`** returns the updated row, or `null` with no write when nothing is pending. It makes one update: it clears `...CLEARED_PENDING_PROPOSAL` and appends `{kind, targetId, reason, dismissedAt: now, text}` to the dismissals.
  - `targetId` is `supersededById` for answered-by and replacement, and absent otherwise.
  - `reason` is the kind's reason column.
  - `text` is `restatementText` for a restatement, and absent otherwise.

  It writes no history row and does not touch the spec.
- **`forgetDismissal(id, {kind, targetId?}, opts)`** returns the updated row. It removes every entry whose kind is equal and whose `targetId` is equal, where absent and null count as equal. It writes `dismissedProposalsJson` null when none are left. When nothing matches, it makes no write and returns the row as it is. Nothing else changes.

## Behaviour (through the module)

Fixture: a session with a current spec, holding:
- S, settled own answer "A" (settledAt t1);
- L, a loose end (`unknown`, "dunno");
- V and W, settled own answers settled later (t2).

| # | Start | Call | Expected |
|---|---|---|---|
| 1 | L with no Proposal | `propose(L, {kind: "answered-by", byId: V, answer: "B", reason: "r"})` | stored; L.proposalKind `answered-by`, supersededById V, supersessionAnswer "B", supersessionReason "r", updatedAt now |
| 2 | S with no Proposal | `propose(S, {kind: "replacement", byId: V, reason: "r"})` | stored; kind `replacement`, supersededById V, supersessionAnswer null |
| 3 | S | `propose(S, {kind: "deferral", reason: "later"})` | stored; kind `deferral`, deferralReason "later" |
| 4 | S | `propose(S, {kind: "restatement", text: "A clean", notes: "n", reason: "r"})` | stored; kind `restatement` and the three columns |
| 5 | S holding a pending deferral | `propose(S, restatement …)` | `{stored: false, skip: "already-pending"}`; S unchanged |
| 6 | L holding answered-by by V | `propose(L, answered-by by W)` | `already-pending`; L still names V |
| 7 | S as `accepted-recommendation` | `propose(S, deferral)` | `not-eligible` |
| 8 | S with a remembered deferral dismissal | `propose(S, deferral)`, then `propose(S, restatement)` | first `dismissed`; second stored |
| 9 | S with a remembered replacement dismissal naming V | `propose(S, replacement by V)`, then `propose(S, replacement by W)` | first `dismissed`; second stored |
| 9b | S replaced (replacedById W) with a remembered deferral dismissal | `propose(S, deferral)` | `dismissed` (dismissed is checked before eligibility) |
| 10 | rows S (dismissed deferral), V (pending restatement) and W | `eligibleFor("deferral", rows)` and `eligibleFor("restatement", rows)` | deferral `[W]`; restatement `[S, W]` |
| 11 | L with a pending answered-by; V | `eligibleFor("answered-by", rows)` | L excluded |
| 12 | S with a pending replacement; V | `eligibleFor("replacement", rows)` | S excluded |
| 13 | L with answered-by by V | `accept(L)` | answer "B", kind `own-answer`, settledById V, one history row, proposalKind null |
| 14 | S with replacement by V, reason "r"; Y holds a pending answered-by naming S; S has a remembered deferral dismissal | `accept(S)` | replacedById V, replacedReason "r", proposal columns and kind null; answer "A" and settledAt t1 kept; no history row; the dismissal kept; Y's answered-by kept; spec not current |
| 15 | S with deferral "later" and a remembered restatement dismissal | `accept(S)` | kind `deferred`, history reason "later"; dismissedProposalsJson null |
| 16 | S with restatement and a remembered deferral dismissal | `accept(S, {statement: " B "})` | answer "B", history as today; dismissedProposalsJson null (a reword forgets too) |
| 17 | S with nothing pending | `accept(S)` and `dismiss(S)` | both `null`; S unchanged, updatedAt included |
| 18 | S with deferral "later" | `dismiss(S)` at t3 | proposal columns and kind null; dismissals `[{kind: "deferral", reason: "later", dismissedAt: t3}]`; no history row; spec still current |
| 19 | L with answered-by by V, "B", "r" | `dismiss(L)` | dismissals `[{kind: "answered-by", targetId: V, reason: "r", dismissedAt}]` |
| 20 | S with restatement "A clean", reason "r", and one earlier dismissal | `dismiss(S)` | two dismissals, the earlier first; the new one has `text: "A clean"` |
| 21 | S with dismissals of a deferral and of a replacement by V | `forgetDismissal(S, {kind: "replacement", targetId: V})` | only the deferral dismissal left; updatedAt now; answer, history and spec unchanged |
| 21b | S with dismissals of an answered-by by V and an answered-by by W | `forgetDismissal(S, {kind: "answered-by"})` | nothing matches (target absent ≠ V or W): both kept, updatedAt unchanged |
| 22 | S with one dismissal | `forgetDismissal` of it | dismissedProposalsJson null |
| 23 | S with a remembered dismissal | `unsettle(S)` (Answer change) | dismissedProposalsJson null |
| 24 | Y holds answered-by naming S | `unsettle(S)` | Y.supersededById and Y.proposalKind null |
| 25 | none | `propose`, `accept`, `dismiss`, `forgetDismissal` on an unknown id | each throws "Decision not found: <id>" |

**Keeping the kind true** (through today's actions, in their test files):

| # | Start | Call | Expected |
|---|---|---|---|
| K1 | nothing pending; the fake interviewer returns one entry of each kind | `find-superseded` | each decision's proposalKind is its kind |
| K2 | S with a pending deferral (kind `deferral`) | dismiss-deferral | proposalKind null |
| K3 | S with a pending replacement (kind `replacement`) | dismiss-supersession | proposalKind null |
| K4 | S with a pending replacement (kind `replacement`) | accept-supersession | proposalKind null |
| K5 | S with a pending restatement (kind `restatement`) | dismiss-restatement | proposalKind null (through `CLEARED_RESTATEMENT`) |

**Migration** (`server/db/migrations.test.ts`: apply the entries before 82, insert rows, then apply all):

| # | Rows before 82 | Expected |
|---|---|---|
| M1 | one row each: a loose end with superseded_by_id; a settled `own-answer` with superseded_by_id; a row with deferral_reason "x"; a row with restatement_text; a row with none | kinds `answered-by`, `replacement`, `deferral`, `restatement`, null; every dismissed_proposals_json null |
| M2 | a `repo-established` row with superseded_by_id; a row with deferral_reason `''`; a row with superseded_by_id `''`; a row with restatement_text `''` | `replacement`; null; null; `restatement` |
| M3 | d2 (deferral and restatement), then d1 (supersession and deferral) | the throw names "d1, d2" in that order and holds the two deferral `UPDATE`s, the supersession one for d1 and the restatement one for d2; no `proposal_kind` column exists afterwards |

## Pattern to copy

- **The module's shape, options and doc header:** `server/answer-change.ts`. Copy its transitions table in the header, its `{now, db?}` options, and its own transaction when it has no handle.
- **The recording-handle spy and `failSpecUpdate`:** `server/answer-change.test.ts:14-70`.
- **The migration test:** `server/db/migrations.test.ts` › "projects-durable-export-folder migration".

## Acceptance

Each module row is one test in `server/proposal.test.ts`, named "row N: …". Each test must fail under the planted bug its line names: the module is new, so a revert proves nothing.

1. **Stores (rows 1 to 4):** planted bug, `propose` writes the payload without `proposalKind`.
2. **The skip order and matching:**
   - row 5: `propose` skips the pending check;
   - row 6: `propose` skips the pending check, so it overwrites;
   - row 7: the eligibility check is dropped;
   - row 8: dismissals match by any kind;
   - row 9: they match by kind only, ignoring the target;
   - row 9b: eligibility is checked before dismissals.
3. **Eligibility (rows 10 to 12):**
   - row 10: `eligibleFor` ignores dismissals, or ignores a pending row;
   - rows 11 and 12: the `proposalKind != null` exclusion is dropped.
4. **Accept:**
   - row 13: the answered-by accept passes `settledById` as null;
   - row 14: the replacement accept goes through `settle`, or calls `withdrawClaimsOn`, or skips `markSpecNotCurrent`;
   - rows 15 and 16: `CLEARED_PROPOSAL` without `dismissedProposalsJson`;
   - row 17: `accept` or `dismiss` writes when nothing is pending.
5. **Dismiss and forget:**
   - row 18: `dismiss` calls `markSpecNotCurrent`, or writes a history row;
   - rows 19 and 20: the dismissal entry drops `targetId`, or replaces earlier entries;
   - row 21: `forgetDismissal` removes by kind only;
   - row 21b: an absent target matches any target;
   - row 22: an empty list is written as `"[]"`.
6. **Answer change and unknown ids:**
   - row 23: `CLEARED_PROPOSAL` without `dismissedProposalsJson`;
   - row 24: `CLEARED_SUPERSESSION` without `proposalKind`;
   - row 25: a missing-row check removed.
7. **Rows K1 to K5** in `actions/find-superseded.test.ts`, `actions/dismiss-deferral.test.ts`, `actions/dismiss-supersession.test.ts` (new), `actions/accept-supersession.test.ts` and `actions/dismiss-restatement.test.ts`. Each fails with its edit from "Keep the kind true" reverted. K1 asserts the four decisions' kinds separately, so reverting any one loop fails it. K5's planted bug is removing `proposalKind` from `CLEARED_RESTATEMENT` alone.
8. **Rows M1 to M3** in `server/db/migrations.test.ts`, under "decisions-proposal-kind-dismissals migration". They fail with the migration reverted. M2 also fails with the kind list hand-written without `repo-established`, with `''` counted as a pending deferral or supersession, and with `''` not counted as a pending restatement.
9. **Routing:** with a caller's handle, `propose`, `accept` (each kind), `dismiss` and `forgetDismissal` make every query through it. This is a recording-handle test, failing with `getDb()` planted in the replacement accept's update, and again with it planted in `forgetDismissal`'s update.
10. **Atomicity of the replacement accept:** with no handle, and `markSpecNotCurrent`'s update made to throw with `failSpecUpdate`, `accept` of a replacement leaves the decision exactly as before. Planted bug: run the two writes without a transaction.
11. **Nothing else moves:** the PR's file list is the Files list below, `server/answer-change.ts` is untouched, and the whole suite passes. The constants test in `actions/accept-deferral.test.ts` (around lines 590-607) is extended with the new fields. Any other test changed is named in the PR body. This line is checked against the diff, not by a test.

## Files

- `grill-room/server/proposal.ts` and `grill-room/server/proposal.test.ts` (new).
- `grill-room/server/db/migrations.ts` (one appended entry), `grill-room/server/db/migrations.test.ts` and `grill-room/server/db/schema.ts`.
- `grill-room/server/tree.ts`: the cleared constants and their doc comments only.
- `grill-room/server/supersession.ts`: the `proposalKind` in the four store loops, and the module doc comment that lists what the scan writes (around lines 26-28).
- `grill-room/actions/dismiss-deferral.ts`, `dismiss-supersession.ts` and `accept-supersession.ts`: the edits under "Keep the kind true" only.
- Tests:
  - `actions/find-superseded.test.ts`, `dismiss-deferral.test.ts` and `accept-supersession.test.ts`: rows K1, K2 and K4;
  - `actions/dismiss-supersession.test.ts` (new): row K3;
  - `actions/dismiss-restatement.test.ts`: row K5;
  - `actions/accept-deferral.test.ts`: its constants test only.

## Builds on

- `grill-room/server/answer-change.ts`: `settle`, `defer`, `reword`, and its "Decision not found" error.
- `grill-room/server/supersession.ts`: `supersedableLooseEnds`, `replaceableDecisions`, `deferrableDecisions`, `scan`.
- `grill-room/server/tree.ts`: `SETTLING_ANSWER_KINDS` and the `CLEARED_*` constants. The import into `server/db/migrations.ts` is intended.
- `grill-room/server/session-state.ts`: `markSpecNotCurrent`, `DbHandle`.
- `@agent-native/core/db`: `MigrationEntry.run`.

## Verify

From `grill-room/`, run `pnpm test`, `pnpm typecheck` and `pnpm lint`; all three exit 0. There is no UI change.

## Merge danger

One-way door: the migration adds columns and backfills them. The PR body must say so, and it merges only on the owner's typed confirmation.

## Open questions

None. The owner decided that the abort message prints the SQL to clear Proposals until one is left per decision. Concurrency is the turn lock's job, so the module has no write guard.
