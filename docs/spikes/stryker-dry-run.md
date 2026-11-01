# Spike: why Stryker's initial test run fails in the mutation step

**Verdict: none of the three failures is a real failure on its branch.** gr-x6w (`4f05d1d`) fails only in Stryker's threads pool, an already-fixed sandbox case. gr-ejh (`4d5291c`) is a load-only flake: `test:mutate CLI: --prefer` runs 8 CLI spawns inside vitest's default 5 s test timeout. gr-3jt9.1 (`84bb286`) did not reproduce in 4 runs; its recorded signature and its 307 s match Stryker's default 5-minute `dryRunTimeoutMinutes`, which is a config limit this repository never sets. In every case the mutation summary throws the cause away before a reviewer sees it.

Bead gr-218o. Every number below is **measured** unless it is marked *inferred*. Stryker 10.0.0, vitest 4.1.11, vitest-runner 10.0.0. The machine was shared with other agents throughout, at load averages of 5 to 28 on 14 cores. 12 Stryker runs were used, the limit: 5 on `84bb286`, 5 on `4f05d1d` (one invalidated by a system sleep) and 2 on `4d5291c`. No run was cut off by the Bash timeout.

The three cases:

| Case | Ticket, PR, round | Commit | Base | Recorded |
|---|---|---|---|---|
| A | gr-3jt9.1, #246, round 2 (wf_174babb8-621) | `84bb286` | `1f54c7da8` | `Error: Something went wrong in the initial test run` (`DryRunExecutor.validateResultCompleted`), 307181 ms |
| B | gr-x6w, #191, round 1 (wf_8d0c2ea0-434) | `4f05d1d` | `ef8f26426` | `ConfigError: There were failed tests in the initial test run.` |
| C | gr-ejh, #249, round 2 (wf_7f211a63-556), added by the main session during the spike | `4d5291c` | `3f49df2` | `runner-failed` after 42970 ms; round 1 was `overrun` after 569959 ms |

## The two setups compared

```
$ git diff 4f05d1d 84bb286 -- grill-room/stryker.config.mjs grill-room/package.json
+import path from "node:path";
+process.env.GRILL_ROOM_REPO_ROOT ??= path.resolve(import.meta.dirname, "..");
 ...
+  ignoreStatic: true,
   concurrency: 2,
   timeoutMS: 30_000,
 (package.json: + "lint": "oxlint --type-aware", + oxlint, + oxlint-tsgolint)
```

`84bb286` has the `GRILL_ROOM_REPO_ROOT` line (`d6ff288`, 2026-10-11 03:03) and `ignoreStatic` (`3c14bda`). `4f05d1d` (2026-10-11 00:31) has neither, and it has no `test/repo-root.ts`. Neither config sets `dryRunTimeoutMinutes`, and neither does today's `main`. `package.json` differs only in lint tooling, which no Stryker run uses. The causes below differ per case, as the configs suggest.

## Question 1: does it reproduce?

Each commit was checked out with `git checkout --detach <commit>` and `(cd grill-room && pnpm install --frozen-lockfile)`. The runner script records the exit code and the wall time around the command, from `grill-room/`.

### A, `84bb286`: not reproduced in 3 runs (4 with load)

Run 1 was `(cd grill-room && pnpm test:mutate --base 1f54c7da8)`, without `--prefer`. The round-2 `--prefer` list could not be recovered: the PR body has been edited since round 2. Runs 2, 3 and 5 ran the `command` from run 1's `summary.json` directly:

```
pnpm exec stryker run --mutate server/interviewer/claude-cli.ts:31-32,...,server/readiness.ts:190-190,server/sharpening.ts:1-133
```

| Run | Command | Exit | Elapsed | Dry run (`Initial test run succeeded. Ran 2683 tests in …`) | Result |
|---|---|---|---|---|---|
| 1 | `pnpm test:mutate --base 1f54c7da8` | 0 | 306 s (`elapsedMs` 305231) | 2 min 45 s | `truncated`, 386 mutants, score 86.53, dropped `server/sharpening.ts:134-152` |
| 2 | the command | 0 | 311 s | 2 min 54 s | `Done in 5 minutes and 10 seconds`, score 86.53 |
| 3 | the command | 0 | 286 s | 2 min 35 s | `Done in 4 minutes and 44 seconds`, score 86.53 |
| 5 | the command plus `--logLevel debug --fileLogLevel trace`, with two full `pnpm test` suites in the background (PIDs 91511, 91515) | 0 | 327 s | **3 min 21 s** | `Done in 5 minutes and 25 seconds`, score 86.53 |

Run 1's `command` starts with `pnpm exec stryker`, so the coverage pre-step was not involved. The dry run passed every time. Under two extra suites it grew from 155 to 201 s, still under 300 s.

### B, `4f05d1d`: reproduced 3 of 3

The command was `pnpm exec stryker run --mutate server/interviewer/schemas.ts:65-67,server/interviewer/schemas.ts:69-69,server/interviewer/schemas.ts:71-87`.

| Run | Exit | Elapsed | Stryker's last error |
|---|---|---|---|
| 6 | 1 | 130 s | `ConfigError: There were failed tests in the initial test run.` |
| 7 | 1 | 2 s | the same |
| 8 | 1 | 2 s | the same |

Each run printed:

```
ERROR DryRunExecutor One or more tests failed in the initial test run:
	where a transcript lives resolves the default config directory under the suite's temp home, never the real one
		expected true to be false // Object.is equality
```

*Inferred*: runs 7 and 8 take 2 s because vitest's sequencer runs the previously failed file first and Stryker's `bail: 1` stops at its first failure.

### C, `4d5291c`: round 1 reproduced; round 2 reproduced only under load

| Run | Command | Exit | Elapsed | Result |
|---|---|---|---|---|
| 10 | `pnpm test:mutate --base 3f49df2` | 0 | 571 s | `overrun`, `elapsedMs` 569713; dry run `Ran 41 tests in 33 seconds`; 101 mutants; `--testFiles scripts/delegation-templates.test.ts,scripts/mutate-diff.test.ts,scripts/review-loop.test.ts` |
| 11 | run 10's `command` plus `--dryRunOnly --logLevel debug --fileLogLevel trace`, with two full suites in the background (PIDs 2092, 2093) | 1 | **46 s** | `ConfigError: There were failed tests in the initial test run.` |

Run 10 matches round 1's `overrun` (569959 ms). Run 11 matches round 2's 42970 ms.

## Question 2: which test fails?

### B

This was run 9, the B command plus `--logLevel debug --fileLogLevel trace` (exit 1, 2 s). `stryker.log` shows vitest's resolved config inside the sandbox, `"pool": "threads"`, `"bail": 1`, with root `.stryker-tmp/sandbox-S4bgdU`, and then:

```
 FAIL  server/interviewer/transcript-tools.test.ts > where a transcript lives > resolves the default config directory under the suite's temp home, never the real one
AssertionError: expected true to be false // Object.is equality
 ❯ server/interviewer/transcript-tools.test.ts:125:59
    123|     const resolved = claudeConfigDir(process.env);
```

The assertion is `expect(resolved.startsWith(`${realHome}${path.sep}`)).toBe(false)`. `test/setup.ts` sets `process.env.HOME`, and in a worker thread that does not change `os.homedir()`, so the path resolves under the real home. That matches gr-ttn's question 3 in `docs/spikes/mutation-gate.md`.

### C

From run 11's output:

```
ERROR DryRunExecutor One or more tests failed in the initial test run:
	test:mutate CLI: --prefer test:mutate CLI: --prefer
		Test timed out in 5000ms.
```

The test is `scripts/mutate-diff.test.ts`, `it("test:mutate CLI: --prefer", …)`. It calls `runCli` 8 times, and each call is a `spawnSync` of `tsx scripts/mutate-diff.ts`. It sets no timeout of its own, so vitest's default of 5000 ms applies (`vitest.config.ts` raises only `hookTimeout`). It has existed since `5c796e1` (gr-g4v.9) and is unchanged on today's `main` (`mutate-diff.test.ts:1291`). gr-ejh's new budget test is not the one that failed: it passed the dry run within its explicit 180000 ms.

### A

There is no failing test to name, because the case did not reproduce. A forced reproduction gives the cause instead. This was run 4, the A command plus `--dryRunTimeoutMinutes 1 --logLevel debug --fileLogLevel trace`:

```
exit=1 elapsed=64s
17:31:20 DEBUG DryRunExecutor Using timeout of 60000 ms.
17:32:23 ERROR DryRunExecutor Initial test run timed out!
17:32:23 ERROR Stryker Unexpected error occurred while running Stryker Error: Something went wrong in the initial test run
    at DryRunExecutor.validateResultCompleted (…/@stryker-mutator/core/dist/src/process/3-dry-run-executor.js)
```

This is the recorded error and stack, word for word. In `3-dry-run-executor.js`, `validateResultCompleted` throws `ConfigError('There were failed tests …')` for failed tests. It throws the generic `Error('Something went wrong in the initial test run')` only for `DryRunStatus.Error` (an error outside a test, logged as `One or more tests resulted in an error`) and for `DryRunStatus.Timeout`. The timeout is `dryRunTimeoutMinutes`, whose default in `stryker-schema.json` is `5`.

**The arithmetic:** a 60 s dry-run timeout gave 64 s from start to exit, so about 4 s of overhead. A 300 s timeout plus about 4 to 7 s of overhead (Stryker starts and instruments in about 6 s in runs 1 to 3) gives about 304 to 307 s. The recorded run took 307181 ms, counted from the Stryker spawn. Round 1 of the same ticket took 268270 ms in all, dry run included. *Inferred*: round 2's dry run, on a machine shared with PR #247's agents and other sessions, passed the 300 s default and was cut off. An `Error`-status run would end whenever the suite ended, not at about 300 s plus overhead.

**A second way to get the same signature, measured by accident:** run 12, `pnpm test:mutate --base ef8f26426` at `4f05d1d`, which was meant to read `stderrTail` for case B. It took 986 s and ended `overrun`. Its log shows `Starting initial test run` at 18:25:56 and `Initial test run timed out!` / `Something went wrong in the initial test run` at 18:42:19. `pmset -g log` shows `Entering Sleep state` at 18:26:29 and `DarkWake` at 18:42:20, after a `caffeinate` assertion this spike did not start ended at 18:25:43. Both timers fired on wake. The run is void as a measurement of case B. It does show that a laptop sleep during the dry run produces case A's message too.

## Question 3: does that test fail outside Stryker?

### B: `transcript-tools.test.ts` (at `4f05d1d`)

```
$ pnpm exec vitest --run server/interviewer/transcript-tools.test.ts      # ×3
      Tests  17 passed (17)        # pass, pass, pass
$ (pnpm test …) &   # PID 70185, ran to completion: Test Files 119 passed, Tests 3240 passed, exit 0
$ pnpm exec vitest --run server/interviewer/transcript-tools.test.ts      # ×3 while it ran
      Tests  17 passed (17)        # pass, pass, pass
$ pnpm exec vitest --run --pool threads server/interviewer/transcript-tools.test.ts
 FAIL  … never the real one
AssertionError: expected true to be false // Object.is equality
      Tests  1 failed | 16 passed (17)
```

It passes 6 of 6 outside Stryker, with and without load. It fails as soon as the threads pool is forced, which is what Stryker's vitest runner does.

### C: `scripts/mutate-diff.test.ts` (at `4d5291c`)

```
$ pnpm exec vitest --run --reporter verbose scripts/mutate-diff.test.ts   # ×3, no suite of mine running (load 27, 19, 15 from other agents)
 ✓ … test:mutate CLI: --prefer 3047ms   /  3063ms  /  2879ms           # pass, pass, pass
```

With load (background `pnpm test` PID 10049, which ended exit 1 with 8 failures, among them `test:mutate CLI: --prefer` and `loadTestIndex … PATH included (L8)`; a second suite, PID 66332, was started when it finished before the three runs, and it ended exit 1 with only `test:mutate CLI: --prefer` failing):

| Loaded run | `test:mutate CLI: --prefer` | Other failure |
|---|---|---|
| 1 | **fail**, 9350 ms | 2 more in the file |
| 2 | pass, 2742 ms | `main: one budget covers coverage and Stryker` failed after 320074 ms |
| 3 | **fail**, 6659 ms | none |

Unloaded the test takes about 3 s, 60 % of its 5 s budget. Under load it failed in 2 of 3 runs. It also failed in 5 of the 6 background full suites that ran beside another suite or a Stryker run: all four at `4d5291c` (PIDs 2092, 2093, 10049, 66332) and one of the two at `84bb286` (PID 91511 failed with `Test timed out in 5000ms`; 91515 passed 3842 of 3842).

### A

There is no failing test to rerun. The dry run passed 2683 of 2683 tests in all 4 runs.

## Question 4: classification

| Case | Class | Evidence |
|---|---|---|
| A, `84bb286` | **Stryker config limit: `dryRunTimeoutMinutes`** (not `timeoutMS` or `concurrency`), reached under load. *Not reproduced naturally.* | The dry run passed 4 of 4, taking 155 to 201 s. The default 5-minute dry-run timeout produces exactly the recorded error and stack (run 4). The recorded 307181 ms equals 300 s plus the measured overhead. A system sleep produces the same message (run 12), so that cause cannot be ruled out for the original round. |
| B, `4f05d1d` | **Sandbox-only**, the threads pool Stryker forces. Already fixed. | It fails 4 of 4 under Stryker and 1 of 1 under `--pool threads`, and passes 6 of 6 under plain vitest, loaded or not. `d6ff288` fixed `os.homedir()` in worker threads after the branch was cut. |
| C, `4d5291c` round 2 | **Load-only (flaky)**: a 5 s default test timeout on a test that spawns `tsx` 8 times. Not a real failure: it passes unloaded. | It fails under load in Stryker's dry run (run 11, 46 s compared with the recorded 43 s), in 2 of 3 loaded plain runs and in 5 of 6 loaded background suites. It passes 3 of 3 unloaded. |
| C, round 1 | **Wall-clock budget**: `overrun`, not a dry-run failure | Run 10: 570 s, matching the recorded 569959 ms. *Inferred*: its 101 mutants run against a file whose budget test alone takes about 22 s, so 2 workers cannot finish them in the time left. |

**What all three share:** `runner-failed` carries no cause.
- Stryker writes its log, including `One or more tests failed …` with the test name and `Initial test run timed out!`, to `process.stdout` (`stryker.js`: `provideLoggingBackend(rootInjector, process.stdout)`).
- `mutate-diff.ts` passes the child's stdout through to its own stderr fd and keeps only a tail of the child's stderr (`runInGroup`, `stdio: ["ignore", process.stderr.fd, "pipe"]`). *Inferred*: so `stderrTail` holds the stack trace without the test name.
- The workflow's mutation schema (`ticket-build-review-loop.js`) has no `stderrTail` field at all, so the three results above record only the status and the elapsed time.

## Question 5: proposed fix (outline, not implemented)

Three tickets, independent of each other. Each goes through the workflow with one lens, except the third, which touches the workflow prompt and its schema and so gets two lenses.

### 1. Give the CLI-spawning tests a timeout that load cannot reach (fixes C round 2; the test is on `main` today)

- **Files:** `grill-room/scripts/mutate-diff.test.ts` only.
- **Change:** give every `it` that spawns the CLI (`runCli` / `runStubbedCli` / `spawnSync`) an explicit timeout, copying the budget test's `180000` pattern.
- **Behaviour rows:**

| Test | Spawns | Timeout today | After |
|---|---|---|---|
| `test:mutate CLI: --prefer` | 8 | 5000 (default) | 60000 |
| `test:mutate CLI: bad input > *` | 1 each | 5000 | 30000 |
| `loadTestIndex … PATH included (L8)` | git + CLI | 5000 | 30000 |
| `main: one budget covers coverage and Stryker` | 14 | 180000 | unchanged |

- **Acceptance:** a planted bug, a `sleep 6` in a stub on the `--prefer` path, fails today and passes after the change. A structural test lists every `it` in the file that calls `runCli(`, `runStubbedCli(` or `spawnSync(` and requires each to carry a numeric timeout argument.

### 2. Name the dry-run timeout in `stryker.config.mjs` (fixes A's limit)

- **Files:** `grill-room/stryker.config.mjs`, plus a test next to `scripts/mutate-diff.test.ts` that reads the config.
- **Change:** set `dryRunTimeoutMinutes` to `Math.ceil(RUN_BUDGET_MS / 60000)` (10 with gr-ejh's 570000), so the gate's own wall clock is the only limit, and a slow dry run ends `overrun` (which the workflow already treats as "skipped, say so") instead of a misleading `runner-failed`.
- **Behaviour rows:**

| Dry run takes | Today | After |
|---|---|---|
| 200 s | dry run passes | dry run passes |
| 310 s, inside the budget | `runner-failed`, "Something went wrong" | dry run passes; the mutants run in what is left, ending `ok`/`truncated` or `overrun` |
| longer than the budget | `runner-failed` at 300 s | `overrun` at the budget |

- **Owner decision:** whether a dry run that eats most of the budget should be allowed at all, or whether the gate should end early when the dry run exceeds half the budget.

### 3. Carry the dry-run cause into the summary and the review (all three cases)

- **Files:** `grill-room/scripts/mutate-diff.ts` (`runInGroup` and `summarize`), `grill-room/scripts/mutate-diff.test.ts`, and `.claude/workflows/ticket-build-review-loop.js` (mutation schema, the `MUTATE` prompt step 4, `mutationText`).
- **Change:**
  - Capture the child's stdout too, still passed through, and on `runner-failed` add a `dryRunFailure` field: the `ERROR DryRunExecutor` lines up to the stack, and the failed test names.
  - Have the workflow require that field and print it after `runner-failed after N s`.
- **Behaviour rows** (Stryker stdout → `dryRunFailure`):

| Stryker stdout contains | `dryRunFailure` |
|---|---|
| `One or more tests failed in the initial test run:` then `\t<suite> <test>` and `\t\t<message>` | `failed tests: <suite> <test>: <message>` (each one) |
| `Initial test run timed out!` | `dry-run timeout` |
| `One or more tests resulted in an error:` then `\t<message>` | `error outside a test: <message>` |
| a finished run | `null` |

- **Seam test:** every shape `mutationText` prints for `runner-failed` is accepted by the workflow schema. A planted bug that drops the field from the schema fails the seam test.
- **Optional**, owner's call: on `dryRunFailure` = `failed tests`, the workflow could rerun the gate once, because 2 of the 3 recorded cases were environmental. This spike would not recommend a retry before tickets 1 and 2 land: with them, a remaining failure is more likely to be real.

### Not proposed

- **Raising `timeoutMS` or lowering `concurrency`.** Neither applies to the dry run, which runs in one runner under its own `dryRunTimeoutMinutes`. No case here was a mutant timeout.
- **Fixing B.** `d6ff288` already did. A branch cut before it and rebased onto `main` does not reproduce it.

## Experiments tried, and reverted

No tracked file was edited. Every experiment was a command-line flag: `--logLevel debug --fileLogLevel trace` (runs 4, 5, 9 and 11), `--dryRunTimeoutMinutes 1` (run 4) and `--dryRunOnly` (run 11). Each `grill-room/stryker.log` they wrote, which is ignored as `*.log`, was copied to the scratchpad and deleted. `.stryker-tmp/` and `.scratch/` stay untracked. All background suites were started and recorded by PID by this spike, and all ran to completion. None was stopped.

## Reproducing

From `grill-room/` after `git checkout --detach <commit>` and `pnpm install --frozen-lockfile`:

```bash
# A, 84bb286
pnpm test:mutate --base 1f54c7da8
CMD=$(jq -r .command .scratch/mutation/summary.json)
eval "$CMD"                                                    # runs 2, 3
eval "$CMD --dryRunTimeoutMinutes 1 --logLevel debug --fileLogLevel trace"   # the recorded signature in about 64 s
# B, 4f05d1d
pnpm exec stryker run --mutate server/interviewer/schemas.ts:65-67,server/interviewer/schemas.ts:69-69,server/interviewer/schemas.ts:71-87
pnpm exec vitest --run --pool threads server/interviewer/transcript-tools.test.ts
# C, 4d5291c
pnpm test:mutate --base 3f49df2                                 # overrun at about 570 s
(pnpm test &) ; (pnpm test &) ; eval "$(jq -r .command .scratch/mutation/summary.json) --dryRunOnly"
pnpm exec vitest --run --reporter verbose scripts/mutate-diff.test.ts   # unloaded, then beside a background pnpm test
```
