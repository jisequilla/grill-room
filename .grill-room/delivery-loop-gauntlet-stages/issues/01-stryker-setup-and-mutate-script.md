# 01 Add StrykerJS on vitest to grill-room with a diff-scoped test:mutate script

Status: ready-for-agent
Blocked by: none
Implements: user stories 21-22, 25-33, 41-42
Implements decisions: `mutation-scope`, `stryker-cap`, `stryker-overrun`, `stryker-setup`, `test-only-pr-scope`, `mutation-score`

Add `@stryker-mutator/core` and `@stryker-mutator/vitest-runner` as pinned devDependencies in `grill-room/package.json`, a minimal `grill-room/stryker.config.mjs` (vitest runner, perTest coverage analysis, concurrency 2, timeout from the cap, JSON reporter written under `.scratch/`), and an npm script `test:mutate` that accepts `--mutate` ranges in path:start-end form. Add a small script (new, under `grill-room/scripts/`) that turns a zero-context `git diff` against main into Stryker ranges for source files only, excluding test files and unchanged files; when the diff touches only test files, run vitest coverage on those test files and emit the covered source line ranges instead. Enforce the cap in the script: 10 minutes wall clock, 100 mutants; on overrun, truncation or runner failure exit with a structured note rather than a failure. Emit a survivor subset (file, line, mutator, run status), the score, the mutant count and the elapsed time as JSON.

Judged by: vitest unit tests for the ranges script (source hunks, excluded test files, test-only coverage path, overrun note shape); `pnpm test` stays green; running `test:mutate` on a sample range against the existing suite finishes inside the cap and writes the JSON report.