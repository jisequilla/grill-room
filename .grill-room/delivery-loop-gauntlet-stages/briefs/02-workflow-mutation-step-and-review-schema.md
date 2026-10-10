# Brief 02: Run Stryker before each review round in the workflow and reshape the REVIEW schema

You are implementing ticket 02 of "Delivery loop: gauntlet stages, PR evidence and mutation testing". You work only inside the git worktree you were started in.

## Step 0: confirm your base

Your worktree was created from `origin/main`. Before anything else, confirm that the existing files this ticket builds on, named under File boundaries, are present. If any is missing, stop and report; do not recreate them.

The bundle is committed in this repository, so your worktree has it. Read the spec at `docs/specs/delivery-loop-gauntlet-stages/spec.md` and your ticket at `.grill-room/delivery-loop-gauntlet-stages/issues/02-workflow-mutation-step-and-review-schema.md`, relative to the repository root in your worktree.

## The ticket

Blocked by: 01 (merged before this brief was delegated)

### 02 Run Stryker before each review round in the workflow and reshape the REVIEW schema

In `.claude/workflows/ticket-build-review-loop.js`: add a deterministic non-agent step that runs the `test:mutate` script from ticket 1 on the full PR diff against main before every review round (including after a fix round), records elapsed time, mutant count and score, and passes only the survivor subset (or the overrun note) into the tests lens reviewer template as filled input. Replace the REVIEW schema's findings plus nits arrays with one findings array whose entries carry level (blocker | should-fix | nit), file, line, claim, evidence command (required for blocker and should-fix) and an optional equivalent-mutant note. Make the review step carry every finding through to the script's result, split by level, so non-blocking findings are returned for the main session. A verdict is pass when only should-fix and nit items remain; blockers force a fix round; should-fix items are handed to the fix round only when a blocker forces one. Keep the two-round cap and the operator-decides outcome unchanged.

Judged by: vitest tests for the schema validation and the routing filter (findings to verdict, fix-round input and returned non-blocking list); the workflow's existing args and multi-lens behaviour unchanged.

## Open questions on this ticket

The consistency check found that this ticket leaves these questions to the owner. Do not choose an answer yourself: if your prompt does not give you the owner's answer to one, stop and report the question instead of building around it.

- Reviewer templates arrive as an anonymous list through args, so how does the workflow identify which one is the tests lens: a named arg, a filename convention, or a placeholder present in the template? ("into the tests lens reviewer template as filled input")
- The workflow script lives at the repo root outside grill-room's vitest setup, so which package and test command runs the tests for the schema and routing code, and is that logic extracted into an importable module to make it testable? ("vitest tests for the schema validation and the routing filter")

## File boundaries

_Grounded at commit `e3dd26f`; the repository has moved since._

Files to create:

- `grill-room/scripts/ticket-build-review-loop.test.ts`

Files to edit:

- `.claude/workflows/ticket-build-review-loop.js`

Existing files it builds on:

- `.claude/templates/delegation/reviewer.md:1-6`
- `.claude/templates/delegation/fix.md:9-11`

## Codebase facts

- The script's header comment lists the args fields (bead, builder, reviewers, fix, start) and says {{pr}}, {{branch}} and {{prior_round}} are left in reviewer templates for the script to fill; a survivors placeholder would be a new fill key. (`.claude/workflows/ticket-build-review-loop.js:12-18`)
- REVIEW declares findings and nits as arrays of strings with verdict enum approved|changes-requested|blocked, and requires verdict, findings, nits and blocked; the ticket replaces the two string arrays with one array of objects. (`.claude/workflows/ticket-build-review-loop.js:46-55`)
- review() flat-maps verdict.findings as strings and returns changes-requested whenever any finding exists, so every item blocks today and nits are never read there; routing by level must replace the `findings.length` test. (`.claude/workflows/ticket-build-review-loop.js:92-96`)
- The strings are used with `.join('\n')` in the prior-round text (line 81) and in the fix prompt (line 100), so object findings need a formatting step there or they print as [object Object]. (`.claude/workflows/ticket-build-review-loop.js:78-104`)
- Each review result is kept in rounds[].review with its verdicts array, so lens nits are inside the returned object today but not surfaced as a list; the returned object per ticket is {bead, pr, branch, outcome, buildVerified, rounds}. (`.claude/workflows/ticket-build-review-loop.js:121-150`)
- The round loop breaks when the verdict is not changes-requested or round is 2, and stores verdict.findings as pendingFix; the two-round cap and the operator-decides outcome live in lines 126-148. (`.claude/workflows/ticket-build-review-loop.js:126-148`)
- The only runtime calls the script makes are agent (lines 69, 72, 84, 100, 110), parallel (82), pipeline (106) and log (71); no call that runs a shell command is shown, so a deterministic non-agent mutation step needs a primitive these lines do not show, or a minimal agent call, which the ticket text rules out. (`.claude/workflows/ticket-build-review-loop.js:68-153`)
- The builder and fixer run with isolation worktree and reviewers make their own scratch worktree of the PR branch, so the script holds no checkout of the PR branch to run test:mutate in; the step must create or be given one. (`.claude/templates/delegation/reviewer.md:18`)
- The file ends with a top-level `return results` and begins with `export const meta`, and uses the globals agent, parallel, pipeline, log and args, so it cannot be imported by vitest; a test must read the file text and evaluate it with stubbed globals (strip the export keyword) or the logic must be duplicated. (`.claude/workflows/ticket-build-review-loop.js:1-10`)
- The file's last statement is `return results`, a top-level return that is invalid in an ES module. (`.claude/workflows/ticket-build-review-loop.js:153`)
- vitest in grill-room collects *.test.ts by default under grill-room/, and scripts/** is in the tsconfig include, so grill-room/scripts/ticket-build-review-loop.test.ts runs under `pnpm test`; the existing test script is `vitest --run --passWithNoTests`. (`grill-room/package.json:15`)
- The vitest config excludes only node_modules, .git, dist, .react-router and e2e, so a test under grill-room/scripts/ is collected. (`grill-room/vitest.config.ts:42-50`)
- The multi-lens behaviour is `reviewers.length > 1` plus an appended ONE_OF_SEVERAL note telling the lens not to run gh pr ready; it must stay unchanged. (`.claude/workflows/ticket-build-review-loop.js:75-76`)
- Repository rule: The saved workflow takes one reviewer template per lens, asks a fixer once more on a missing commit or running verification, and is continued with `start`, not resume; these behaviours must stay. (`.claude/rules/worktrees.md:15-18`).
- Repository rule: Changes requested go back to the builder and after two rejected rounds the operator decides; the round cap in the script must stay at two. (`.claude/rules/worktrees.md:77`).

## Builds on

- Ticket 01: the test:mutate npm script and the ranges script's JSON output (survivors with file, line, mutator, status; score; mutant count; elapsed; overrun note) — ticket 01 adds `test:mutate` to `grill-room/package.json` — check: `grep -q 'test:mutate' grill-room/package.json`

## Proved by

Test: `grill-room/scripts/ticket-build-review-loop.test.ts`

```bash
cd grill-room && pnpm exec vitest --run scripts/ticket-build-review-loop.test.ts
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

Otherwise run `git push -u origin HEAD`, then `gh pr create --draft` against `main`, titled `<bead id>: Run Stryker before each review round in the workflow and reshape the REVIEW schema`, with a body giving the ticket path, the files changed, the exact verification output, and anything this brief left ambiguous. Never merge, and never mark it ready — the reviewer does that once it approves.

## Report, then stop

Report:

- worktree path and branch;
- the PR URL, or "push pending: gh account" with your commit hash;
- commits and files changed;
- the exact output of `just check`;
- anything ambiguous, and anything this brief was missing.

A separate reviewer reviews the work before any merge.

Then stop. Do no further work of any kind.
