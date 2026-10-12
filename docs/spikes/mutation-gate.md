# Spike: why the mutation gate rarely ends `ok`

Bead gr-ttn. `pnpm test:mutate` (`grill-room/scripts/mutate-diff.ts`, config `grill-room/stryker.config.mjs`) runs before every review round of `.claude/workflows/ticket-build-review-loop.js`. Of the recorded app-code runs, only gr-g4v.9 ended `ok`. This spike times the gate on two real PR diffs, finds where the time goes and why lines are dropped, reproduces the gr-x6w failure, and measures six candidate changes on the same diffs.

The diffs:
- **gr-qpo.2** (PR #209): merge `4ad7368` against its parent `29274d7`, 6 source files, 147 mutants. It ended `truncated` twice.
- **gr-qpo.1** (PR #206): head `6076f71` against `24d9ada`, 7 source files, 446 mutants. It ended `overrun` twice.

Every number below is **measured** unless it is marked *inferred*. The commands are under "Reproducing the numbers".

**The machine was shared.** Other agents were running throughout, at load averages of 7 to 25 on 14 cores. Two identical runs (E2, E2b) took 591 s and 316 s. The dry run is stable within ±10 %. The mutant phase is not, so treat a single wall-clock figure as ±50 %.

## Recommendation (question 4)

**Make four changes together:**

1. Set `ignoreStatic: true` in `stryker.config.mjs`.
2. Have `mutate-diff.ts` pass `--testFiles` with the PR's changed non-e2e test files. When the PR changes no test file, keep today's run on related tests.
3. Leave out of the scope the `app/**/*.tsx` files that no vitest test reaches, and `app/i18n/**`. A component with a `*.test.tsx` sibling stays in: the repository has 15 such vitest files that render their components, for example `turn-attempt-log.test.tsx`. The rule this spike can support is narrower: a `.tsx` file with no `*.test.tsx` sibling and no test importing it. `app/components/output/tickets-section.tsx` is such a file. In the full run all 14 of its mutants are NoCoverage, so no vitest test executes it.
4. Raise `CAP` from 100 to 500 mutants and keep the 600 s wall clock.

**Measured effect:**

| Diff | Today | With the four changes |
|---|---|---|
| gr-qpo.2 | `truncated`: 96 of 147 mutants, 323 s, score 84.4; `shared/input-gaps.ts` not mutated | **`ok`**: all 128 in-scope mutants, **101 s** (E8; 71 s with UI lines kept, E6), score **99.2** |
| gr-qpo.1 | `overrun` at 600 s; the 97 mutants it kept take **1,292 s** uncapped | **`ok`**: 426 of the full diff's 446 mutants counted (20 ignored), **261 s**, score **90.1** |

Under the new cap, gr-qpo.1 (446 mutants) and gr-qpo.2 (128) both fit. Narrowing recommendation 3 to `.tsx` files without vitest coverage leaves both measurements as they are. On gr-qpo.2 the only `.tsx` file in scope, `tickets-section.tsx`, has no `*.test.tsx` sibling and no test imports it, so E8 excludes exactly what the narrowed rule excludes. gr-qpo.1 changes no `app/` file. The largest app PR measured, at 446 mutants, finishes in under half the wall clock.

**Cost, measured:**

- **`ignoreStatic` costs kills on module-level code.** A static mutant changes something only evaluated at import (a top-level constant, a scenario table in `server/interviewer/fake.ts`). On gr-qpo.2 it ignores 5 mutants: 3 i18n survivors and 2 kills in `shared/input-gaps.ts`. On gr-qpo.1's kept set it ignores 5 and runs 36 hybrid mutants with their covering tests only. Kills fall from 84 to 73 there, and the score from 87.6 to 80.4. That is the price of avoiding a full environment reload plus every related test per static mutant, which is what overran (question 1).
- **`--testFiles` loses no kill on either diff, but only together with `ignoreStatic`.**
  - **Alone on gr-qpo.2 (E6) it loses 2 kills.** The 140 non-static mutants have identical outcomes. The 2 static mutants in `input-gaps.ts` go from Killed to Survived, and only `ignoreStatic` takes them out of the count. The 3 i18n mutants go from Survived to NoCoverage.
  - **On gr-qpo.1, with `ignoreStatic`, it hides 7 survivors.** Kills are identical (382 = 382), but those 7 survivors become Ignored: 433 mutants are counted without `--testFiles` and 426 with it. `summarize()` skips Ignored mutants (`mutate-diff.ts:301`), so the reviewer never sees those 7 survivors. They also account for the whole score rise from 88.7 to 90.1: counted as survivors, 384 / 433 is 88.7 again.
  - *Inferred risk*: a PR that changes source without touching the test that covers it would see NoCoverage survivors. That case falls back to related tests, which is today's behaviour.
- **Leaving out uncovered `.tsx` files and i18n lines loses no kill on these diffs, but it hides 17 survivors.** In E2, the 14 `tickets-section.tsx` mutants are NoCoverage and the 3 i18n strings are Survived. None was killed, and all 17 disappear from the survivor list the reviewer gets. The Playwright scenarios remain the guard for those files. With them out, the score measures the vitest tests alone: 99.2 instead of 87.8 on the same tests. *Inferred*: a `.tsx` file that some vitest test reaches without a `*.test.tsx` sibling would lose real kills under the sibling rule. Checking NoCoverage in a dry run would be the exact test.
- **The 500 cap is a guess sized from two diffs.** 446 mutants took 261 s here. A diff heavy in hybrid mutants could still overrun. The wall clock remains the backstop and still reports `overrun`.

**Not recommended:**

- **Concurrency 4.** Measured faster: 200 s and 218 s against 316 s and 591 s at 2 on the full gr-qpo.2 scope. But the workflow runs up to three tickets at once, each with its own Stryker. *Inferred*: doubling workers per run would raise the load that already doubles run times. Revisit it only if the combined change is still too slow.
- **Incremental mode.** A warm re-run with nothing changed still takes 151 s, because Stryker always repeats the dry run (E7). The combined change already costs less than that floor.
- **Narrowing to related test files.** This is already on: `vitest.related` defaults to true in `@stryker-mutator/vitest-runner`, and per-test coverage already runs only covering tests per mutant. `--testFiles` is the narrowing that still pays.

**Two cheap fixes worth making with it** (*inferred*, not measured as wall time):
- Have `splitAtCap` skip a line that does not fit instead of stopping at it.
- Have the coverage-only scope mutate the source files the changed tests are named after, not every line they execute (question 2, gr-0l4). That reopens decision `test-only-pr-scope`, which prescribes today's behaviour, so it is the owner's call.

## Question 1: where the time goes

**A run has two phases.** First a dry run: one vitest instance, one thread, collecting per-test coverage over every test file related to the mutated files. Then the mutant runs, two Stryker workers each running one vitest thread.

| Run | Dry run | Mutant phase | Mutants | Tests completed |
|---|---|---|---|---|
| gr-qpo.2 gate as recorded (kept 96) | 151 s, 2,284 tests | 167 s | 96 | 2,071 total, mean 21.6 per mutant |
| gr-qpo.2 full scope, c2 (E2 / E2b) | 156 s / 158 s, 2,362 tests | 432 s / 155 s | 147, 5 static | 4,752 |
| gr-qpo.1 kept set, c2, uncapped | 170 s, 2,582 tests | **1,119 s** | 97, **41 static** | 21,677 in `fake.ts`'s 29 static mutants alone |

- **The dry run is half of a typical run, and concurrency does not touch it.** It costs 150 to 170 s whatever `concurrency` says, because Stryker runs it in one runner. Inside each runner vitest is pinned to `pool: 'threads', maxWorkers: 1` by the vitest runner, so every test file boots its PGlite one after another.
- **Tests per mutant.**
  - gr-qpo.2's kept mutants are covered by a mean of 125 tests (median 21, maximum 537) across a mean of 5.1 test files (maximum 17).
  - With bail on, a mean of 21.6 tests actually run per mutant.
  - The 14 `.tsx` mutants and 1 other run nothing: they are NoCoverage.
- **Static mutants are what overran gr-qpo.1.** A static mutant is evaluated only at import, so Stryker reloads the environment and runs every related test for it.
  - 41 of the 97 kept mutants are static: 29 in `server/interviewer/fake.ts`, 7 in `schemas.ts`, 3 in `db/schema.ts` and 2 in `db/migrations.ts`.
  - The 29 in `fake.ts` alone ran 21,677 tests.
  - With `--ignoreStatic` the same 97 mutants take 86 s in the mutant phase instead of 1,119 s, and 261 s in all.
- **A full vitest run does not explain the 600 s.** All 3,458 tests in 124 files take 73 s at the configured 6 workers and 225 s at 1 worker. The dry run covers a subset of 2,284 to 2,582 tests in 150 to 170 s, and a single run of it is well inside the cap. The overrun came from the static mutants re-running that subset dozens of times.
- *Inferred*: the recorded 285 to 500 s runs of gr-6uc, gr-930 and gr-568 ran three at a time in one workflow. On a loaded machine the mutant phase alone varied 155 to 432 s for identical input here.

## Question 2: why the cap drops what it drops

**The cap is 100 mutants, not 100 lines.** `countMutantLines` runs Stryker's instrumenter on the scope and counts mutants per line.

**How `planStrykerRun` orders the lines:**
- Lines inside a `--prefer` range come first, the rest after.
- Within each group the order is the scope's order. That is the diff's order, alphabetical by path.
- `splitAtCap` walks that list and **stops at the first line that would exceed the cap**. That line and everything after it are dropped, including zero-mutant lines.
- `status` is `truncated` whenever `dropped` is non-empty (`mutate-diff.ts:317`).

**Why `shared/input-gaps.ts` was dropped on gr-qpo.2** (reproduced exactly: the plan keeps 98, the same 11 dropped ranges):
- The Evidence ranges hold 142 of the diff's 147 mutants, so preference alone already exceeds the cap.
- In path order, `actions/`, `app/`, `server/handoff.ts` and `server/tickets.ts` come first. They use 98 mutants and the cap breaks inside `server/tickets.ts:1095-1145`, at line 1140.
- **The plan counts 98 but Stryker runs 96.** The plan counts mutants by start line over the whole diff. Two mutants start on kept lines in `server/tickets.ts` but end on dropped lines. Stryker places a mutant only when it falls wholly inside a `--mutate` range, so it leaves those two out. Instrumenting just the kept ranges gives 96, matching Stryker line for line.
- `shared/` sorts last, so the whole new module and its 40 preferred mutants were dropped. It was not dropped for lack of tests: with nothing dropped, all 42 of its mutants are killed (E2).
- **"Preferred first" therefore means "alphabetically first among the preferred"** whenever the Evidence alone is over the cap.
- gr-qpo.1 shows the same effect. Its kept set is `actions/break-into-tickets.ts`, `server/db/*` and `server/interviewer/*`. The PR's main subject, `server/tickets.ts` (331 mutants, 307 of them preferred), is dropped except lines 309-317. Its 18 dropped ranges match the recorded ones exactly.

**The cap was not sized against the clock.**
- The decision (`docs/specs/delivery-loop-gauntlet-stages/decisions.md`, `stryker-cap`) says "fits a diff of a few hundred lines, leaves headroom for a machine under load". That was the interviewer's estimate, not a measurement.
- Measured cost per mutant spans an order of magnitude:
  - about 1.7 s on gr-qpo.2's kept set;
  - about 11.5 s on gr-qpo.1's kept set, because of its static mutants;
  - 0.55 s on gr-qpo.1's full diff once static mutants are ignored and tests narrowed.
- So 100 mutants overran on one PR and finished in 5 minutes on another. A mutant count is a poor proxy for time unless static mutants are handled.

**gr-0l4 (PR #211, merged as `e9d4ce6`): a lockfile change mutated `add-decision.ts`.** That PR changed no grill-room source file:
- `package.json`, `pnpm-lock.yaml` and `.oxlintrc.json` have no source extension;
- `scripts/lint-config.test.ts` and the three edited `.test.ts` files match `TEST_SIDE`.

So `rangesFromDiff` was empty and `scopeFor` took the coverage branch. That branch is meant for test-only PRs (decision `test-only-pr-scope`). It runs vitest with v8 coverage on the changed test files and turns **every covered line of every source file they execute** into scope.

Reproduced at `2bc2e0b` with three of its four test files (`actions/ask-consistency-findings.test.ts`, `server/project-facts.test.ts`, `server/projects.test.ts`; 175 tests):
- the scope is 57 source files, 677 ranges, 6,528 lines and 5,400 mutants;
- with no `--prefer` that can match, the cap keeps the alphabetically first lines: `actions/add-decision.ts`, `actions/answer-decision.ts`, then the start of `actions/ask-consistency-findings.ts`, the same order as the recorded run.

**This is the scope decision `test-only-pr-scope` prescribes** (`docs/specs/delivery-loop-gauntlet-stages/decisions.md`): "Mutate the source lines the new or changed tests cover", which it calls "the honest scope for a test-only PR". The decision did not anticipate one consequence: a test that drives a whole action stack covers dozens of files, and the cap then keeps whichever sort first. Changing that reopens the decision, which is the owner's call. The PR's Evidence ranges (`package.json:13-13`, `.oxlintrc.json:1-5`, test lines) could never match, which `preferNotCovered` records.

The recorded summary lists 117 dropped ranges where this reproduction drops 653. The one test file not reproduced does not account for that gap. Its cause is unverified: possibly the reporting agent trimmed the list.

## Question 3: why gr-x6w was `runner-failed`

**Reproduced.** Run `pnpm test:mutate --base ef8f264` at gr-x6w's head `4f05d1d`:
- The scope is `server/interviewer/schemas.ts:65-87`, 23 mutants.
- It ends `runner-failed` after 145 s, the recorded run's 169 s within load.
- Stryker reports `ConfigError: There were failed tests in the initial test run`.

**The failing test** is `server/interviewer/transcript-tools.test.ts`: "resolves the default config directory under the suite's temp home, never the real one", failing with `expected true to be false`.

**Cause:**
- Stryker's vitest runner forces the `threads` pool.
- In a worker thread, setting `process.env.HOME` in `test/setup.ts` does not change `os.homedir()`.
- So `claudeConfigDir` resolved under the real home.

**Already fixed.** `d6ff288` (gr-g4v.10, merged 2026-10-11 03:03) makes `os.homedir()` follow `HOME` in worker threads. gr-x6w's branch was cut from `ef8f264`, before that fix. On today's main the same two test files pass Stryker's dry run (118 tests).

Nothing more is needed. A branch cut before `d6ff288` and rebased onto main would not reproduce it.

## Every candidate, measured

These are gr-qpo.2 runs, each mutating the full 147-mutant scope with no cap unless stated, from `grill-room/` at `2bc2e0b`. Its grill-room tree is identical to `4ad7368`.

| Run | Change | Wall | Dry run | Mutant phase | Mutants | Score |
|---|---|---|---|---|---|---|
| baseline | the gate as recorded (cap 100, `--prefer`) | 323 s | 151 s | 167 s | 96 | 84.4 (`truncated`) |
| E2 / E2b | no cap (cap removed or raised) | 591 s / 316 s | 156 / 158 s | 432 / 155 s | 147 | 87.8 |
| E3 | `--ignoreStatic` | 349 s | 165 s | 180 s | 142 (5 ignored) | 89.4 |
| E4 / E4b | `--concurrency 4` | 218 s / 200 s | 155 / 148 s | 61 / 50 s | 147 | 87.8 |
| E5 | no `tickets-section.tsx` or i18n lines | 322 s | 146 s | 174 s | 130 | 99.2 |
| E6 | `--testFiles` = the PR's 7 changed test files | **71 s** | **19 s**, 739 tests | 49 s | 147 | 86.4 |
| E7 | `--incremental`, cold then warm with no change | 324 s / 151 s | 150 / 149 s | 173 / 0 s | 147 | 87.8 |
| E8 | E3 + E5 + E6 | **101 s** | 19 s | 78 s | 128 (2 ignored) | **99.2** |

And on gr-qpo.1, from `grill-room/` at `6076f71`:

| Run | Change | Wall | Dry run | Mutant phase | Mutants | Score |
|---|---|---|---|---|---|---|
| q1-kept | the 97 the gate kept, no wall clock | 1,292 s | 170 s | 1,119 s | 97 (41 static) | 87.6 |
| q1-kept-is | the same with `--ignoreStatic` | 261 s | 172 s | 86 s | 92 | 80.4 |
| q1-full-is | full diff, `--ignoreStatic` | 439 s | 172 s | 265 s | 433 | 88.7 |
| q1-full-combo | full diff, `--ignoreStatic` + `--testFiles` (7 changed tests) | **261 s** | **24 s**, 695 tests | 234 s | 426 (20 ignored, 7 of them survivors in q1-full-is) | **90.1** |

Under the gate's 600 s clock, gr-qpo.1 passes with `ignoreStatic` alone (439 s), but only with about 160 s of headroom on a loaded machine. `--testFiles` takes 148 s off the dry run and is what makes the margin comfortable.

## Reproducing the numbers

All commands run from `grill-room/` with `pnpm install --frozen-lockfile` done. For gr-qpo.2 the worktree is at `4ad7368` or later main with an identical grill-room tree (`git diff --stat 4ad7368 2bc2e0b -- grill-room` is empty). For gr-qpo.1 it is at `git checkout --detach 6076f71`, and for gr-x6w at `git checkout --detach 4f05d1d`.

**Phase times** come from Stryker's log:
- the dry run is the `Initial test run succeeded. Ran N tests in …` line;
- the mutant phase is the time between that line and `Done in …`.

**Wall** is `date +%s` around the command. **Mutant counts, statuses, static flags, `coveredBy` and `testsCompleted`** come from `.scratch/mutation/stryker-report.json`. The score is (Killed + Timeout) / (mutants − Ignored).

```bash
# gr-qpo.2 baseline: the gate exactly as the workflow ran it
pnpm test:mutate --base 29274d7 --prefer "server/tickets.ts:1095-1144,shared/input-gaps.ts:1-62,server/handoff.ts:1412-1425,server/handoff.ts:1647-1649,server/handoff.ts:2287-2287,server/handoff.ts:195-206,actions/list-tickets.ts:48-48,app/components/output/tickets-section.tsx:116-118,app/components/output/tickets-section.tsx:274-299"

# gr-qpo.2 full scope (E2); add the flag per row for E3, E4, E6, E7
Q2=actions/list-tickets.ts:6-6,actions/list-tickets.ts:48-48,app/components/output/tickets-section.tsx:8-8,app/components/output/tickets-section.tsx:116-118,app/components/output/tickets-section.tsx:275-285,app/components/output/tickets-section.tsx:290-298,app/i18n/en-US.ts:701-703,server/handoff.ts:54-54,server/handoff.ts:84-84,server/handoff.ts:87-87,server/handoff.ts:199-206,server/handoff.ts:1412-1426,server/handoff.ts:1647-1649,server/handoff.ts:2287-2287,server/tickets.ts:12-12,server/tickets.ts:37-37,server/tickets.ts:1095-1145,shared/input-gaps.ts:1-65
pnpm exec stryker run --mutate "$Q2"                        # E2, E2b
pnpm exec stryker run --mutate "$Q2" --ignoreStatic         # E3
pnpm exec stryker run --mutate "$Q2" --concurrency 4        # E4, E4b
T2=actions/break-into-tickets.test.ts,actions/handoff.test.ts,actions/list-tickets.test.ts,actions/set-ticket-blocked-by.test.ts,server/handoff.test.ts,server/tickets.test.ts,shared/input-gaps.test.ts
pnpm exec stryker run --mutate "$Q2" --testFiles "$T2"      # E6
pnpm exec stryker run --mutate "$Q2" --incremental --incrementalFile .scratch/mutation/incremental-exp.json   # E7, twice
# E5 and E8: Q2 without the five app/ ranges
Q2S=actions/list-tickets.ts:6-6,actions/list-tickets.ts:48-48,server/handoff.ts:54-54,server/handoff.ts:84-84,server/handoff.ts:87-87,server/handoff.ts:199-206,server/handoff.ts:1412-1426,server/handoff.ts:1647-1649,server/handoff.ts:2287-2287,server/tickets.ts:12-12,server/tickets.ts:37-37,server/tickets.ts:1095-1145,shared/input-gaps.ts:1-65
pnpm exec stryker run --mutate "$Q2S"                                         # E5
pnpm exec stryker run --mutate "$Q2S" --ignoreStatic --testFiles "$T2"        # E8

# Full suite
pnpm exec vitest --run                  # 73 s, 3,458 tests
pnpm exec vitest --run --maxWorkers=1   # 225 s

# gr-qpo.1, at 6076f71
K1=actions/break-into-tickets.ts:234-238,actions/break-into-tickets.ts:261-263,actions/break-into-tickets.ts:295-301,server/db/migrations.ts:637-642,server/db/schema.ts:635-645,server/interviewer/fake.ts:1118-1160,server/interviewer/prompt.ts:534-547,server/interviewer/schemas.ts:278-287,server/tickets.ts:309-317
pnpm exec stryker run --mutate "$K1"                  # q1-kept
pnpm exec stryker run --mutate "$K1" --ignoreStatic   # q1-kept-is
F1=actions/break-into-tickets.ts:31-33,actions/break-into-tickets.ts:181-182,actions/break-into-tickets.ts:234-238,actions/break-into-tickets.ts:261-263,actions/break-into-tickets.ts:295-301,actions/break-into-tickets.ts:356-365,server/db/migrations.ts:637-643,server/db/schema.ts:633-645,server/interviewer/fake.ts:272-272,server/interviewer/fake.ts:1118-1160,server/interviewer/fake.ts:1219-1220,server/interviewer/prompt.ts:534-547,server/interviewer/schemas.ts:273-287,server/tickets.ts:30-56,server/tickets.ts:292-292,server/tickets.ts:294-294,server/tickets.ts:304-326,server/tickets.ts:528-533,server/tickets.ts:554-559,server/tickets.ts:587-589,server/tickets.ts:630-694,server/tickets.ts:1013-1186
T1=actions/ask-consistency-findings.test.ts,actions/break-into-tickets.test.ts,actions/check-consistency.test.ts,server/interviewer/claude-cli.test.ts,server/interviewer/scenarios.test.ts,server/interviewer/schemas.test.ts,server/tickets.test.ts
pnpm exec stryker run --mutate "$F1" --ignoreStatic                     # q1-full-is
pnpm exec stryker run --mutate "$F1" --ignoreStatic --testFiles "$T1"   # q1-full-combo

# gr-x6w, at 4f05d1d: runner-failed, the failing test is named in the stderr
pnpm test:mutate --base ef8f264
# and on main, the same test passes the dry run
pnpm exec stryker run --mutate server/interviewer/schemas.ts:65-87 --testFiles server/interviewer/transcript-tools.test.ts,server/interviewer/schemas.test.ts
```

**Kept and dropped sets and mutant counts per file** come from the script's own exports, without starting Stryker. Run this as a `.mts` file through `pnpm exec tsx`. Pass `<base>`, then the `--prefer` list (or `""`), then the cap:

```ts
import { countMutantLines, planStrykerRun, scopeFor } from "./scripts/mutate-diff.ts";
const [base, prefer, cap] = process.argv.slice(2);
const scope = scopeFor(base, process.cwd());
if (scope.kind === "ranges") {
  const counted = await countMutantLines(scope.ranges, process.cwd());
  const plan = planStrykerRun(counted, Number(cap ?? 100), prefer ? prefer.split(",") : []);
  console.log(counted.reduce((a, c) => a + c.count, 0), plan.kept, plan.dropped);
}
```

- On gr-qpo.2 (`29274d7`, with the prefer list above): 147 mutants, of which 142 are preferred, and 98 are kept. Run `countMutantLines` on the kept ranges alone to get Stryker's 96.
- On gr-qpo.1 (`24d9ada`, with its PR's Evidence ranges): 446 mutants, of which 399 are preferred, 100 are kept, and the same 18 ranges are dropped as recorded.

**The gr-0l4 scope**, at `2bc2e0b`:

```bash
pnpm exec vitest --run --coverage.enabled --coverage.provider=v8 --coverage.reporter=json --coverage.reportsDirectory=<dir> actions/ask-consistency-findings.test.ts server/project-facts.test.ts server/projects.test.ts
```

Then pass `<dir>/coverage-final.json` through `rangesFromCoverage`, `countMutantLines` and `planStrykerRun(counted, 100, [])`. The result is 57 files, 677 ranges and 5,400 mutants, with the kept set starting at `actions/add-decision.ts`.
