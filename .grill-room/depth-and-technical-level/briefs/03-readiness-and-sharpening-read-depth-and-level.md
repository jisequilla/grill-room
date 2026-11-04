# Brief 03: Readiness takes depth; Sharpening takes depth and level

You are implementing ticket 03 of "Depth and technical level before the grill". You work only inside the git worktree you were started in.

## Step 0: confirm your base

Your worktree was created from `origin/main`. Before anything else, confirm that the existing files this ticket builds on, named under File boundaries, are present. If any is missing, stop and report; do not recreate them.

The bundle is committed in this repository, so your worktree has it. Read the spec at `docs/specs/depth-and-technical-level/spec.md` and your ticket at `.grill-room/depth-and-technical-level/issues/03-readiness-and-sharpening-read-depth-and-level.md`, relative to the repository root in your worktree.

## The ticket

Blocked by: 01 (merged before this brief was delegated)

### 03 Readiness takes depth; Sharpening takes depth and level

Give `grill-room/server/readiness.ts` a `depth` input. The prompt states the depth and the bar per step: proof of concept needs only a clear thing to try; first working version needs the user and the core flows; full spec keeps today's bar. The stored judgment records the `depth` it was made at. `grill-room/actions/assess-readiness.ts` reads the session's depth and passes it. Readiness still warns, never blocks, and is only requested before round 1. `grill-room/app/components/workspace/readiness-panel.tsx` shows 'judged before depth existed' when the field is empty.

`grill-room/server/sharpening.ts` receives the same depth and the owner's technical level (live via `getTechnicalLevel`, default `DEFAULT_TECHNICAL_LEVEL`) and applies the same wording and recommendation rules as the grill (see ticket 6's level section; share the prompt fragment). When a re-judge arriving during Sharpening finds the idea ready, Sharpening lets its open round finish and then stops.

Judged by: extend `grill-room/server/readiness.test.ts` so the same thin idea is ready at proof-of-concept and not ready at full spec and the judgment carries depth; `grill-room/server/sharpening.test.ts` shows level in the Sharpening prompt and the open round completing with no further round after a ready judgment; `grill-room/app/components/workspace/readiness-panel.test.tsx` covers the empty-depth label.

## File boundaries

Files to create:

- `grill-room/server/readiness-depth.test.ts`
- `grill-room/app/components/workspace/readiness-panel-depth.test.tsx`

Files to edit:

- `grill-room/server/readiness.ts`
- `grill-room/actions/assess-readiness.ts`
- `grill-room/server/interviewer/prompt.ts`
- `grill-room/server/interviewer/types.ts`
- `grill-room/app/components/workspace/readiness-panel.tsx`

Files that reference a symbol it reshapes (edit any of them as the change requires):

- `storeReadiness`: every file `git grep -lw storeReadiness` lists from the project root (2 when grounded)

Existing files it builds on:

- `grill-room/server/readiness.ts:293-300`
- `grill-room/server/readiness.ts:320-337`
- `grill-room/server/interviewer/prompt.ts:1652-1689`
- `grill-room/actions/get-current-round.ts:43`

## Codebase facts

- server/sharpening.ts holds only two pure refusal functions (reasonsToRefuseSharpenCards, reasonsToRefuseSharpenRewrite) and builds no prompt, so 'Sharpening receives depth and level' is done in prompt.ts's sharpen prompts, not in sharpening.ts. (`grill-room/server/sharpening.ts:1-75`)
- The sharpen-cards and sharpen-rewrite prompts are built by buildSharpenCardsPrompt and buildSharpenRewritePrompt from the request's context and carry no depth or level text today. (`grill-room/server/interviewer/prompt.ts:917-1000`)
- No file under actions/ or app/ references sharpening except a get-tree test, so the code shows no driver that runs sharpening rounds, and the behaviour 'an open Sharpening round finishes and then stops' has nothing existing to attach to in this ticket. (`grill-room/server/sharpening.ts:1-18`)
- The readiness prompt states a fixed bar (evidence, a non-process objective, at most MAX_READY_UNKNOWNS unknowns) with no depth input. (`grill-room/server/interviewer/prompt.ts:754-816`)
- reasonsToRefuseReadiness hardcodes the ready bar (at least one evidence item, a non-null non-process objective, unknowns within the cap), so a proof-of-concept idea with no evidence cannot be stored as ready until this function takes the depth. (`grill-room/server/readiness.ts:254-289`)
- storeReadiness takes (idea, result, judgedAt, scoutReportId) and serializes the StoredReadiness object, so recording the depth adds a parameter to it and to its caller in assess-readiness. (`grill-room/server/readiness.ts:125-138`)
- assess-readiness builds the request context from the session row, calls getInterviewer().assessReadiness, and stores the judgment with readinessOverrideJson set to null, which is what clears 'Grill it as is'. (`grill-room/actions/assess-readiness.ts:84-137`)
- assess-readiness refuses via failIfPastFirstRound once any round exists or a turn is working, which is the pre-round-1 limit the ticket keeps. (`grill-room/actions/assess-readiness.ts:44-48`)
- InterviewContext holds sessionId, idea, title, model, answeringMode, conversationId, docsFolder, decisions and projectContext, with no depth or technicalLevel, so this ticket adds them (optional, so the other context builders still compile). (`grill-room/server/interviewer/types.ts:114-141`)
- get-current-round returns readiness from currentReadiness(session), so a depth field added to StoredReadiness reaches the panel through the Readiness type without a new action field. (`grill-room/actions/get-current-round.ts:43`)
- ReadinessPanel takes the stored readiness (null when none) and renders the verdict and badge, so the 'judged before depth existed' label is added there from the judgment's depth being null. (`grill-room/app/components/workspace/readiness-panel.tsx:53-109`)
- Ticket 6 is not a blocker of this ticket, so the shared technical-level prompt fragment it exports does not exist when this ticket starts; this ticket must define or import it itself and ticket 6 reuses it. (`grill-room/server/interviewer/prompt.ts:819-824`)
- sharpening.test.ts already imports buildPrompt and asserts on the sharpen prompts, the prior art for prompt tests of the new inputs. (`grill-room/server/sharpening.test.ts:1-24`)
- The suite runs with vitest --run and default discovery, which collects both new *.test.ts and *.test.tsx files. (`grill-room/package.json:16`)
- Repository rule: A ticket changing both a model prompt and the server check that enforces it carries a seam test: every readiness answer shape the depth-aware prompt describes passes reasonsToRefuseReadiness. (`.claude/rules/worktrees.md:29`).
- Repository rule: Each acceptance line names a test that fails with the change reverted, including the empty-depth label. (`.claude/rules/worktrees.md:28`).

## Builds on

- Ticket 01: DEPTHS and DEFAULT_DEPTH in shared/session-constants.ts, sessions.depth, the optional depth field in the stored readiness schema, and getTechnicalLevel in server/owner-profiles.ts — ticket 01 adds `DEPTHS` to `grill-room/shared/session-constants.ts` — check: `grep -q DEPTHS grill-room/shared/session-constants.ts`

## Proved by

Test: `grill-room/server/readiness-depth.test.ts`

```bash
pnpm --dir grill-room exec vitest --run server/readiness-depth.test.ts app/components/workspace/readiness-panel-depth.test.tsx
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

Otherwise run `git push -u origin HEAD`, then `gh pr create --draft` against `main`, titled `<bead id>: Readiness takes depth; Sharpening takes depth and level`, with a body giving the ticket path, the files changed, the exact verification output, and anything this brief left ambiguous. Never merge, and never mark it ready — the reviewer does that once it approves.

## Report, then stop

Report:

- worktree path and branch;
- the PR URL, or "push pending: gh account" with your commit hash;
- commits and files changed;
- the exact output of `just check`;
- anything ambiguous, and anything this brief was missing.

A separate reviewer reviews the work before any merge.

Then stop. Do no further work of any kind.
