# 03 A browser test for each flow

Status: ready-for-agent
Blocked by: 02
Suggested model: sonnet

## What to build

One Playwright test per flow under `e2e/`, each creating its own session and choosing its scenario through `use-fake-scenario` before the first request:
- readiness: a not-ready idea shows its verdict and missing items; a ready one shows its evidence
- reopen and stale review: reopening a settled decision shows the what-changed digest, with its attempt log
- refusal then success: round history's attempt log shows the refusal row then the success row
- rate limit then retry, with the live log: while the turn runs, the live attempt log is visible; after the rate limit, the failed panel shows it apart from an interviewer error; after the retry, the log shows the manual-retry separator and the counter restarted at 1
- supersession: the done panel shows the proposed supersession and its attempt log

Scope every locator to the panel it tests (`data-testid`), since several attempt logs can be on one page. Keep the existing smoke test as it is. Allow more than one test file against the server now that sessions are isolated; stay on one worker unless a test proves otherwise.

## How it will be judged

- `just e2e` passes with every test, run three times in a row without a failure.
- Verification: `pnpm exec vitest --run --maxWorkers=3`, `pnpm typecheck`, `just e2e`.
