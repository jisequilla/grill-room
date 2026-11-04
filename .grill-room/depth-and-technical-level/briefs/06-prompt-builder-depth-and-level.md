# Brief 06: Interviewer prompt pitched to depth and technical level

You are implementing ticket 06 of "Depth and technical level before the grill". You work only inside the git worktree you were started in.

## Step 0: confirm your base

Your worktree was created from `origin/main`. Before anything else, confirm that the existing files this ticket builds on, named under File boundaries, are present. If any is missing, stop and report; do not recreate them.

The bundle is committed in this repository, so your worktree has it. Read the spec at `docs/specs/depth-and-technical-level/spec.md` and your ticket at `.grill-room/depth-and-technical-level/issues/06-prompt-builder-depth-and-level.md`, relative to the repository root in your worktree.

## The ticket

Blocked by: 01 (merged before this brief was delegated)

### 06 Interviewer prompt pitched to depth and technical level

Add `depth` and `technicalLevel` inputs to `buildPrompt` in `grill-room/server/interviewer/prompt.ts` and `grill-room/server/interviewer/types.ts`; `grill-room/server/turn.ts` reads depth from the session and level live via `getTechnicalLevel`, falling back to `DEFAULT_TECHNICAL_LEVEL` when null. Export the level prompt fragment so Sharpening (ticket 3) reuses it.

Depth section: proof of concept skips scale, edge-case and operations branches and proposes done once the core thing to try is settled; first working version opens edge-case branches, skips scale and operations, and proposes done when every user-facing flow and its data are settled with technology and operations allowed as builder's calls; full spec opens everything and holds done until nothing is left to the builder's guesswork.

Level section: builder keeps today's wording; technical-not-building keeps technical wording but phrases recommendations as consequences and recommends 'Leave it to the builder' for pure technology choices with no owner-visible consequence; not-technical uses plain wording (no paths or product names in card bodies) with the same recommendation shape. Technology cards are never suppressed; the interviewer never records its own recommendation as settled. Extend `grill-room/server/interviewer/fake.ts` to honour both inputs.

Judged by: prompt tests asserting each depth and level section per value (not exact wording); a fake scenario where a not-technical owner's technology card recommends builder's call while a builder's does not.

## File boundaries

Files to create:

- `grill-room/server/interviewer/prompt-depth-level.test.ts`

Files to edit:

- `grill-room/server/interviewer/prompt.ts`
- `grill-room/server/interviewer/types.ts`
- `grill-room/server/interviewer/fake.ts`
- `grill-room/server/interviewer/test-fixtures.ts`
- `grill-room/actions/request-next-round.ts`

Existing files it builds on:

- `grill-room/server/turn.ts:352-352`
- `grill-room/server/interviewer/prompt.ts:1652-1689`

## Codebase facts

- buildPrompt returns the readiness, sharpen, scout, handoff and consistency prompts by request kind, and builds the interview prompt for the rest from interviewerInstructions, renderContext and renderTask. (`grill-room/server/interviewer/prompt.ts:1652-1689`)
- The propose-round task ends with the `done` rule ('null unless the frontier is genuinely empty and nothing is left silently assumed'), which is the line the depth-dependent done guidance changes. (`grill-room/server/interviewer/prompt.ts:324-325`)
- renderContext is also used by the consistency prompt, so a depth or level section placed there would reach checks the spec says must not vary with level; the section belongs in the propose-round task instead. (`grill-room/server/interviewer/prompt.ts:151-194`)
- InterviewContext has no depth or technicalLevel today, and the app builds that context separately in each action, so the grill-round value comes from request-next-round's context literal rather than from turn.ts. (`grill-room/server/interviewer/types.ts:114-141`)
- request-next-round builds the propose-round context from the session row (sessionId, idea, title, model, answeringMode, docsFolder, decisions, projectContext), where depth and the live technical level are added. (`grill-room/actions/request-next-round.ts:307-320`)
- The fake interviewer is a scripted queue that records every request in `requests`, so it does not interpret depth or level itself; a test asserts the request it received carries both, and a scenario scripts the builder's-call recommendation. (`grill-room/server/interviewer/fake.ts:210-217`)
- aContext in test-fixtures is the default InterviewContext every prompt test builds on, so new optional fields need defaults there only if made required. (`grill-room/server/interviewer/test-fixtures.ts:54-69`)
- The ticket text says turn.ts reads depth, but turn.ts holds runTurn, askUntilAccepted and projectContextFor and does not build the interview context. (`grill-room/server/turn.ts:100-186`)
- Prompt tests exist that call buildPrompt with fixtures (sharpening.test.ts), the model for the per-value section tests. (`grill-room/server/sharpening.test.ts:1-24`)
- Ticket 3 is not a blocker of this ticket and also edits prompt.ts and types.ts, so the two edits must be merged and the level fragment defined once. (`grill-room/server/interviewer/prompt.ts:917-963`)
- The suite collects server/**/*.test.ts through vitest --run default discovery. (`grill-room/package.json:16`)
- Repository rule: Each acceptance line (each depth section, each level section, builder's-call recommendation for a not-technical owner) names a test that fails with the change reverted. (`.claude/rules/worktrees.md:28`).

## Builds on

- Ticket 01: TECHNICAL_LEVELS, DEFAULT_TECHNICAL_LEVEL and DEPTHS constants, sessions.depth and getTechnicalLevel in server/owner-profiles.ts — ticket 01 adds `DEFAULT_TECHNICAL_LEVEL` to `grill-room/shared/session-constants.ts` — check: `grep -q DEFAULT_TECHNICAL_LEVEL grill-room/shared/session-constants.ts`

## Proved by

Test: `grill-room/server/interviewer/prompt-depth-level.test.ts`

```bash
pnpm --dir grill-room exec vitest --run server/interviewer/prompt-depth-level.test.ts
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

Otherwise run `git push -u origin HEAD`, then `gh pr create --draft` against `main`, titled `<bead id>: Interviewer prompt pitched to depth and technical level`, with a body giving the ticket path, the files changed, the exact verification output, and anything this brief left ambiguous. Never merge, and never mark it ready — the reviewer does that once it approves.

## Report, then stop

Report:

- worktree path and branch;
- the PR URL, or "push pending: gh account" with your commit hash;
- commits and files changed;
- the exact output of `just check`;
- anything ambiguous, and anything this brief was missing.

A separate reviewer reviews the work before any merge.

Then stop. Do no further work of any kind.
