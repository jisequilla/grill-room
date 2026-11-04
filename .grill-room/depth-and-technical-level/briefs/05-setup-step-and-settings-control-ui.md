# Brief 05: Setup step at session creation and the mid-grill settings control

You are implementing ticket 05 of "Depth and technical level before the grill". You work only inside the git worktree you were started in.

## Step 0: confirm your base

Your worktree was created from `origin/main`. Before anything else, confirm that the existing files this ticket builds on, named under File boundaries, are present. If any is missing, stop and report; do not recreate them.

The bundle is committed in this repository, so your worktree has it. Read the spec at `docs/specs/depth-and-technical-level/spec.md` and your ticket at `.grill-room/depth-and-technical-level/issues/05-setup-step-and-settings-control-ui.md`, relative to the repository root in your worktree.

## The ticket

Blocked by: 01, 04 (merged before this brief was delegated)

### 05 Setup step at session creation and the mid-grill settings control

Extend `grill-room/app/components/sessions/create-session-dialog.tsx` with a setup step before the session is created: depth (three choices with one-line plain help) and technical level pre-filled from `get-owner-profile`, with nothing selected when the profile has none. Skip creates the session with `DEFAULT_DEPTH` and leaves the profile untouched. A level pick writes through `set-owner-technical-level`. Pass depth into `create-session` so readiness runs after it.

Add a header control beside `grill-room/app/components/workspace/session-model-control.tsx` to edit depth and level at any round via the ticket 4 actions, with copy 'applies from the next round'; when `pendingDepth` is set, show 'applies when this step finishes'; when done has been proposed or a spec exists, warn that changing depth reopens the grill and marks the spec and tickets stale. Use 'readiness' and 'builder's call'; never 'preflight' or 'open question'. Add i18n keys in `grill-room/app/i18n/en-US.ts`.

Judged by: component tests for skip defaults, empty first-time level, pre-fill and write-back, pending indicator and stale warning; a Playwright spec `grill-room/e2e/depth-and-level.spec.ts` creating a session through the step and changing both values mid-grill.

## Open questions on this ticket

The consistency check found that this ticket leaves these questions to the owner. Do not choose an answer yourself: if your prompt does not give you the owner's answer to one, stop and report the question instead of building around it.

- Is a level pick in the setup step saved to the profile the moment it is picked, or only when the session is created, so that picking a level and then cancelling or skipping leaves the profile untouched? ("A level pick writes through `set-owner-technical-level`.")

## File boundaries

Files to create:

- `grill-room/app/components/workspace/session-depth-level-control.tsx`
- `grill-room/app/components/workspace/session-depth-level-control.test.tsx`
- `grill-room/e2e/depth-and-level.spec.ts`

Files to edit:

- `grill-room/app/components/sessions/create-session-dialog.tsx`
- `grill-room/app/routes/sessions.$sessionId.tsx`
- `grill-room/app/i18n/en-US.ts`
- `grill-room/actions/create-session.ts`

Existing files it builds on:

- `grill-room/app/components/workspace/session-model-control.tsx:28-118`
- `grill-room/app/lib/decisions.ts:1-1`

## Codebase facts

- The create dialog is a single form (title, idea, model, answering mode, docs folder, project) that submits through useActionMutation("create-session") with a draft kept in local storage, so the setup step either extends this form or adds a second step before mutate. (`grill-room/app/components/sessions/create-session-dialog.tsx:179-214`)
- handleSubmit sends title, idea, model, answeringMode and optional docsFolder and projectId, so depth is a new argument to both the mutate call and the create-session schema. (`grill-room/app/components/sessions/create-session-dialog.tsx:200-214`)
- create-session's zod schema lists title, idea, model, answeringMode, docsFolder and projectId, with no depth input. (`grill-room/actions/create-session.ts:15-46`)
- SessionModelControl is the model for the header control: it calls useActionMutation("set-session-model"), shows a Select, reports errors in a span and calls onChanged to refresh. (`grill-room/app/components/workspace/session-model-control.tsx:28-118`)
- The session route renders SessionModelControl in the header chip row, passing sessionId, model, modelLocked from the session payload and refresh as onChanged, which is where the new control is placed. (`grill-room/app/routes/sessions.$sessionId.tsx:489-503`)
- The en-US messages keep the model control's strings as modelSelectLabel, modelLockedError and modelChangeFailed under the workspace group; the other locale files exist beside it and this ticket must confirm whether they need the same keys. (`grill-room/app/i18n/en-US.ts:319-321`)
- get-session returns the row spread plus modelLocked, so the control reads depth, pendingDepth and technicalLevel from the payload ticket 4 adds. (`grill-room/actions/get-session.ts:26-31`)
- The stale warning needs state (done-proposed or confirmed) and spec existence from the session payload; state is a sessions column with interviewing, done-proposed and confirmed values. (`grill-room/shared/session-constants.ts:23-29`)
- The suite collects *.test.tsx component tests through vitest --run default discovery, with e2e excluded from vitest and run by Playwright through just e2e. (`grill-room/package.json:16`)
- The just check recipe runs typecheck, lint, test and e2e, and e2e runs playwright test --project=chromium. (`justfile:94-101`)
- Repository rule: A ticket that changes what the user sees adds or extends a Playwright scenario under grill-room/e2e/ and is checked with agent-browser against an isolated fake-interviewer server. (`.claude/rules/worktrees.md:66-67`).
- Repository rule: Verification for a UI ticket includes just e2e besides pnpm test, typecheck and lint. (`.claude/rules/worktrees.md:55`).
- Repository rule: Each acceptance line (skip defaults, empty first-time level, pre-fill and write-back, pending indicator, stale warning) names a test that fails with the change reverted. (`.claude/rules/worktrees.md:28`).

## Builds on

- Ticket 01: DEPTHS, TECHNICAL_LEVELS and DEFAULT_DEPTH in shared/session-constants.ts — ticket 01 adds `TECHNICAL_LEVELS` to `grill-room/shared/session-constants.ts` — check: `grep -q TECHNICAL_LEVELS grill-room/shared/session-constants.ts`
- Ticket 04: the set-session-depth, set-owner-technical-level and get-owner-profile actions and the get-session depth, pendingDepth and technicalLevel fields — created by ticket 04 at `grill-room/actions/get-owner-profile.ts` — check: `test -f grill-room/actions/get-owner-profile.ts`

## Proved by

Test: `grill-room/app/components/workspace/session-depth-level-control.test.tsx`

```bash
pnpm --dir grill-room exec vitest --run app/components/workspace/session-depth-level-control.test.tsx
```

## Rules

- Create and edit files only within the file boundaries above. If the ticket cannot be done inside them, stop and report instead of widening them.
- Build test fixtures in the encoding production uses for the same data: when a Codebase fact states how a value is stored or sent, match it, and never encode a value twice (such as JSON.stringify into a JSON column).
- Run git only inside your worktree. Never run git against another checkout, never commit directly on `main`, and never merge anything.
- Commit on your worktree branch as you go.

## Verify

From the repository root in your worktree, this must exit 0:

```bash
just check
```

## Delivery

When verification passes, run `gh auth status`. If the active account is not the one this repository expects, do not switch it: stop after committing and report "push pending: gh account" with your commit hash.

Otherwise run `git push -u origin HEAD`, then `gh pr create --draft` against `main`, titled `<bead id>: Setup step at session creation and the mid-grill settings control`, with a body giving the ticket path, the files changed, the exact verification output, and anything this brief left ambiguous. Never merge, and never mark it ready — the reviewer does that once it approves.

## Report, then stop

Report:

- worktree path and branch;
- the PR URL, or "push pending: gh account" with your commit hash;
- commits and files changed;
- the exact output of `just check`;
- anything ambiguous, and anything this brief was missing.

A separate reviewer reviews the work before any merge.

Then stop. Do no further work of any kind.
