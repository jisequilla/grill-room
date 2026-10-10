# 02 Run Stryker before each review round in the workflow and reshape the REVIEW schema

Status: ready-for-agent
Blocked by: 01
Implements: user stories 23-24, 34, 43, 47, 52-54
Implements decisions: `mutation-runner`, `stryker-rerun-in-fix-round`, `review-schema-shape`, `severity-scale`, `should-fix-routing`

In `.claude/workflows/ticket-build-review-loop.js`: add a deterministic non-agent step that runs the `test:mutate` script from ticket 1 on the full PR diff against main before every review round (including after a fix round), records elapsed time, mutant count and score, and passes only the survivor subset (or the overrun note) into the tests lens reviewer template as filled input. Replace the REVIEW schema's findings plus nits arrays with one findings array whose entries carry level (blocker | should-fix | nit), file, line, claim, evidence command (required for blocker and should-fix) and an optional equivalent-mutant note. Make the review step carry every finding through to the script's result, split by level, so non-blocking findings are returned for the main session. A verdict is pass when only should-fix and nit items remain; blockers force a fix round; should-fix items are handed to the fix round only when a blocker forces one. Keep the two-round cap and the operator-decides outcome unchanged.

Judged by: vitest tests for the schema validation and the routing filter (findings to verdict, fix-round input and returned non-blocking list); the workflow's existing args and multi-lens behaviour unchanged.