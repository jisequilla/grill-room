# Brief 01: Add StrykerJS on vitest to grill-room with a diff-scoped test:mutate script

You are implementing ticket 01 of "Delivery loop: gauntlet stages, PR evidence and mutation testing". You work only inside the git worktree you were started in.

## Step 0: confirm your base

Your worktree was created from `origin/main`. Before anything else, confirm that the existing files this ticket builds on, named under File boundaries, are present. If any is missing, stop and report; do not recreate them.

The bundle is committed in this repository, so your worktree has it. Read the spec at `docs/specs/delivery-loop-gauntlet-stages/spec.md` and your ticket at `.grill-room/delivery-loop-gauntlet-stages/issues/01-stryker-setup-and-mutate-script.md`, relative to the repository root in your worktree.

## The ticket

Blocked by: none

### 01 Add StrykerJS on vitest to grill-room with a diff-scoped test:mutate script

Add `@stryker-mutator/core` and `@stryker-mutator/vitest-runner` as pinned devDependencies in `grill-room/package.json`, a minimal `grill-room/stryker.config.mjs` (vitest runner, perTest coverage analysis, concurrency 2, timeout from the cap, JSON reporter written under `.scratch/`), and an npm script `test:mutate` that accepts `--mutate` ranges in path:start-end form. Add a small script (new, under `grill-room/scripts/`) that turns a zero-context `git diff` against main into Stryker ranges for source files only, excluding test files and unchanged files; when the diff touches only test files, run vitest coverage on those test files and emit the covered source line ranges instead. Enforce the cap in the script: 10 minutes wall clock, 100 mutants; on overrun, truncation or runner failure exit with a structured note rather than a failure. Emit a survivor subset (file, line, mutator, run status), the score, the mutant count and the elapsed time as JSON.

Judged by: vitest unit tests for the ranges script (source hunks, excluded test files, test-only coverage path, overrun note shape); `pnpm test` stays green; running `test:mutate` on a sample range against the existing suite finishes inside the cap and writes the JSON report.

## Open questions on this ticket

The consistency check found that this ticket leaves these questions to the owner. Do not choose an answer yourself: if your prompt does not give you the owner's answer to one, stop and report the question instead of building around it.

- Stryker's timeoutMS is a per-mutant test-run limit, not a run-wide wall clock, so what per-mutant timeout should the config set given the ten-minute wall-clock cap is enforced by the script? ("timeout from the cap")

## File boundaries

_Grounded at commit `e3dd26f`; the repository has moved since._

Files to create:

- `grill-room/stryker.config.mjs`
- `grill-room/scripts/mutate-diff.ts`
- `grill-room/scripts/mutate-diff.test.ts`

Files to edit:

- `grill-room/package.json`
- `grill-room/pnpm-lock.yaml`

Existing files it builds on:

- `grill-room/test/git-repos.ts:65-105`
- `grill-room/vitest.config.ts:23-52`
- `grill-room/package.json:7-20`

## Codebase facts

- The scripts block holds a single test script, `vitest --run --passWithNoTests`, and no mutation script; test:mutate is added here. (`grill-room/package.json:7-20`)
- The devDependencies block lists vitest ^4.1.5 and @playwright/test 1.62.1 and no @stryker-mutator or vitest coverage-provider entry, so the test-only coverage path needs a coverage provider the ticket text does not name, in addition to the two Stryker packages. (`grill-room/package.json:52-110`)
- vitest runs from grill-room/ with default test discovery plus setupFiles ./test/setup.ts and an exclude list that drops **/e2e/**; a *.test.ts file under grill-room/scripts/ is therefore collected by `pnpm test` (the runner's default include is **/*.{test,spec}.?(c|m)[jt]s?(x)). (`grill-room/vitest.config.ts:32-51`)
- The vitest runner is invoked by the package.json test script, which is what `just test` and `just check` run. (`grill-room/package.json:15`)
- Every test file boots its own in-memory PGlite and the config caps maxWorkers at 2 to 6 because boot cost grows with concurrent boots; a Stryker run with concurrency 2 multiplies that boot per mutant batch, which is the cost the 10-minute cap has to absorb. (`grill-room/vitest.config.ts:6-23`)
- The hook timeout is 30 s because a loaded machine has been slower than anything measured; the mutate step runs the same suite so its timeout setting must sit above that. (`grill-room/vitest.config.ts:37-41`)
- tsconfig includes scripts/**/* and test/**/*, so the new script and its test are type-checked by `pnpm typecheck`. (`grill-room/tsconfig.json:21-32`)
- useTempGitRepos().create({files, commit}) returns a real committed git repository under os.tmpdir() that is removed after each test; it is the existing way to give the ranges script a real diff against a main-like commit. (`grill-room/test/git-repos.ts:65-105`)
- The helper's private git() runs commands with stdio ignored and exposes no way to make a second commit or branch, so a test needing a diff against main must run its own git commands inside the returned root. (`grill-room/test/git-repos.ts:35-55`)
- grill-room/.gitignore lists .tmp/, e2e/artifacts/ and test-results/ and does not list .scratch/, so a JSON report written under grill-room/.scratch/ shows as untracked until ticket 5 adds the exclude step. (`grill-room/.gitignore:31-57`)
- pnpm-workspace.yaml allows build scripts only for tesseract.js, node-pty and esbuild; it states no policy for the Stryker packages. (`grill-room/pnpm-workspace.yaml:1-4`)
- Repository rule: The builder runs pnpm test and pnpm typecheck from grill-room/ in the foreground, and keeps inside the ticket's files, naming any file outside them in the PR body. (`.claude/rules/worktrees.md:49-51`).

## Proved by

Test: `grill-room/scripts/mutate-diff.test.ts`

```bash
cd grill-room && pnpm exec vitest --run scripts/mutate-diff.test.ts
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

Otherwise run `git push -u origin HEAD`, then `gh pr create --draft` against `main`, titled `<bead id>: Add StrykerJS on vitest to grill-room with a diff-scoped test:mutate script`, with a body giving the ticket path, the files changed, the exact verification output, and anything this brief left ambiguous. Never merge, and never mark it ready — the reviewer does that once it approves.

## Report, then stop

Report:

- worktree path and branch;
- the PR URL, or "push pending: gh account" with your commit hash;
- commits and files changed;
- the exact output of `just check`;
- anything ambiguous, and anything this brief was missing.

A separate reviewer reviews the work before any merge.

Then stop. Do no further work of any kind.
