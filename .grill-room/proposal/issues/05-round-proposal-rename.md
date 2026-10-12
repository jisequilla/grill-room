# 05 Rename the round proposal

Status: ready-for-agent
Blocked by: 04
Suggested model: sonnet

## Intent

"Proposal" now means one thing in the glossary: a pending suggestion about a decision's answer (spec: `.grill-room/proposal/spec.md`, story 38). The code also says "proposal" for what an interviewer turn returns for a round, which the glossary now calls the **round proposal**. This ticket renames that sense in identifiers and comments. It is mechanical and changes no behaviour.

## What to build

Rename these identifiers, with every reference, and their test names:

| Today | Renamed |
|---|---|
| `validateProposal` (`server/tree.ts`) | `validateRoundProposal` |
| `proposalTurnId` (`actions/request-next-round.ts`) | `roundProposalTurnId` |
| `proposalTurn` (helper in `actions/request-next-round.test.ts`) | `roundProposalTurn` |

Then reword comments and doc comments in `server/tree.ts`, `actions/request-next-round.ts` and `server/interviewer/` where "proposal" or "the proposal" means a round's output (new decisions, push-back responses, placements, `done`), so they say "round proposal". The `pendingAsk` comment in `actions/request-next-round.ts` around line 126 is one.

**Do not rename:**
- delegation proposals (`delegationProposals*`, `PendingDelegationProposal`, `dismissDelegationProposal`, the handoff `proposalShapes` / `ProposalShapes` and `noProposals` / `proposalsOnly`);
- scout proposals (`ScoutProposalDisposition`, `retryProposal` in `actions/scout-project.test.ts`, `aProposal` in `actions/repo-decisions.test.ts` and `server/interviewer/schemas.test.ts`);
- decision Proposals (`server/proposal.ts` and its callers);
- `Proposed*` types (`ProposedDecision`, `ProposedPushBackResponse`), which name proposed decisions, not the round proposal;
- any stored string (turn kinds such as `propose-round`, column names, action names, the `done-proposed` state);
- any JSON key or prompt text the model sees;
- anything under `e2e/fixtures/demo-project/`, which is a fixture copy of another tree.

Read each other identifier or comment containing "proposal" before renaming it. Rename only the round-proposal sense, and list in the PR body anything ambiguous you left as it is.

## Behaviour

None changes. The whole suite, typecheck and lint pass before and after with the same test count.

## Acceptance

1. `grep -rn 'validateProposal\b\|proposalTurnId\b\|\bproposalTurn\b' grill-room --include='*.ts' --include='*.tsx'`, excluding `node_modules` and `e2e/fixtures`, prints nothing. Quote that command and its empty output in the PR body.
2. The full suite passes with the same test count as `origin/main` at the branch point. Quote both counts.
3. The PR changes no string literal that reaches the database, the model or an action name. The PR body lists the files changed and confirms this.

## Files

- `grill-room/server/tree.ts`, `grill-room/actions/request-next-round.ts` and `grill-room/actions/request-next-round.test.ts`.
- Every other file that imports `validateProposal` (today `server/interviewer/fake.test.ts`), and comments under `grill-room/server/interviewer/`.
- Not `e2e/fixtures/`.

## Builds on

- `grill-room/server/tree.ts`: `validateProposal`.
- `GLOSSARY.md`: Round proposal.

## Verify

From `grill-room/`, run `pnpm test`, `pnpm typecheck` and `pnpm lint`; all three exit 0. There is no UI change.

## Merge danger

Two-way door.

## Open questions

None.
