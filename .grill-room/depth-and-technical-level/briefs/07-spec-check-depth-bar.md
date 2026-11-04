# Brief 07: Spec names the depth and the spec check scales its builder-alone bar

You are implementing ticket 07 of "Depth and technical level before the grill". You work only inside the git worktree you were started in.

## Step 0: confirm your base

Your worktree was created from `origin/main`. Before anything else, confirm that the existing files this ticket builds on, named under File boundaries, are present. If any is missing, stop and report; do not recreate them.

The bundle is committed in this repository, so your worktree has it. Read the spec at `docs/specs/depth-and-technical-level/spec.md` and your ticket at `.grill-room/depth-and-technical-level/issues/07-spec-check-depth-bar.md`, relative to the repository root in your worktree.

## The ticket

Blocked by: 01 (merged before this brief was delegated)

### 07 Spec names the depth and the spec check scales its builder-alone bar

Pass depth into spec synthesis and the consistency check. In `grill-room/server/interviewer/prompt.ts` the spec prompt names the depth in Summary and Further Notes; the builder-alone check accepts builder-alone decisions at proof-of-concept, flags only user-facing ones at first working version, and keeps today's bar at full spec. `grill-room/actions/synthesize-spec.ts` and `grill-room/actions/check-consistency.ts` read the session's depth. Technical level is not passed downstream; the plain-words Summary rule stays fixed. Tickets and handoff unchanged.

Judged by: extend `grill-room/server/consistency.test.ts` so the same decision set yields a builder-alone finding at full spec and none at proof-of-concept; a spec test asserting the depth appears.

## File boundaries

Files to create:

- `grill-room/server/consistency-depth.test.ts`

Files to edit:

- `grill-room/server/interviewer/prompt.ts`
- `grill-room/server/interviewer/types.ts`
- `grill-room/actions/synthesize-spec.ts`
- `grill-room/server/consistency.ts`

Existing files it builds on:

- `grill-room/server/consistency.ts:341-381`
- `grill-room/actions/check-consistency.ts:80-82`

## Codebase facts

- The spec task prompt tells the interviewer to write the template plus a Summary of 5 to 10 plain-word bullets and lists further rules, which is where 'name the depth in Summary and Further Notes' is added. (`grill-room/server/interviewer/prompt.ts:487-517`)
- synthesize-spec builds the SynthesizeSpecRequest context from the session row and validates the result with specRefusalReasons, so depth is added to that context literal. (`grill-room/actions/synthesize-spec.ts:219-248`)
- The consistency task prompt defines six finding kinds and says 'Be conservative', with no depth input, so the bar per depth is added to consistencyTaskSection. (`grill-room/server/interviewer/prompt.ts:1563-1618`)
- buildConsistencyPrompt renders renderContext, the spec, the tickets and the task, from a CheckConsistencyRequest. (`grill-room/server/interviewer/prompt.ts:1626-1644`)
- The consistency turn loads the session itself and builds the context literal in consistency.ts, so check-consistency.ts only calls runConsistencyTurn(sessionId) and needs no edit. (`grill-room/server/consistency.ts:356-381`)
- check-consistency delegates to runConsistencyTurn(sessionId), passing only the id. (`grill-room/actions/check-consistency.ts:80-82`)
- The builder-alone judgment is made by the model against the prompt; consistencyReasons and keepValidFindings validate finding shape and quotes, so 'no finding at proof-of-concept' is enforced by the prompt text, not a server rule, unless this ticket adds one. (`grill-room/server/consistency.ts:385-388`)
- The consistency check runs only for a confirmed session with a spec and current tickets, refusing with not-confirmed, spec-missing, no-tickets or tickets-not-current. (`grill-room/actions/check-consistency.ts:34-71`)
- InterviewContext carries no depth today. (`grill-room/server/interviewer/types.ts:114-141`)
- The suite collects server/**/*.test.ts through vitest --run default discovery. (`grill-room/package.json:16`)
- Repository rule: The ticket changes a model prompt (spec and consistency task) and the server check behind it, so it carries a seam test that every finding shape the depth-scaled prompt describes passes consistencyReasons. (`.claude/rules/worktrees.md:29`).
- Repository rule: Each acceptance line (depth named in the spec prompt, bar per depth) names a test that fails with the change reverted. (`.claude/rules/worktrees.md:28`).

## Builds on

- Ticket 01: DEPTHS constant and sessions.depth column — ticket 01 adds `DEPTHS` to `grill-room/shared/session-constants.ts` — check: `grep -q DEPTHS grill-room/shared/session-constants.ts`

## Proved by

Test: `grill-room/server/consistency-depth.test.ts`

```bash
pnpm --dir grill-room exec vitest --run server/consistency-depth.test.ts
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

Otherwise run `git push -u origin HEAD`, then `gh pr create --draft` against `main`, titled `<bead id>: Spec names the depth and the spec check scales its builder-alone bar`, with a body giving the ticket path, the files changed, the exact verification output, and anything this brief left ambiguous. Never merge, and never mark it ready — the reviewer does that once it approves.

## Report, then stop

Report:

- worktree path and branch;
- the PR URL, or "push pending: gh account" with your commit hash;
- commits and files changed;
- the exact output of `just check`;
- anything ambiguous, and anything this brief was missing.

A separate reviewer reviews the work before any merge.

Then stop. Do no further work of any kind.
