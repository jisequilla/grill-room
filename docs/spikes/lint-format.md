# Spike: a linter and formatter for grill-room

Bead gr-rn6. grill-room runs typecheck, vitest, mutation testing, Playwright and doctor, but no lint step and no format step. This spike asks whether a linter and a formatter would earn their place. It runs on `grill-room/` at `ad7fc56`:
- oxlint, oxfmt and Biome with default settings;
- the oxlint rules nearest to Anti-Slop's rule families.

It then classifies what they find, measures what a one-time format would change, and checks whether Vite+ could sit beside agent-native's CLI.

## Verdict: adopt only a linter, with one rule

**On current code, no linter run found a real bug.** That covers four runs:
- default oxlint;
- type-aware oxlint;
- Biome;
- the Anti-Slop-equivalent set: 1,319 findings, 242 of them in production code.

Every finding sampled was style or noise.

**The delegation record has one catch: 1 of 82 failed first attempts.**
- gr-c0t.26 erased the delegation proposals' types to `unknown`. On the pre-fix commit `11e5368`, `typescript/no-unnecessary-type-parameters` fires on exactly that code. That rule is type-aware and off by default.
- With the fix (`b59dc8c`) the rule is silent there.
- All 111 `typescript/*` rules were run on that pair, and it is the only rule whose findings change.
- Five other type- or schema-shaped failures were re-run the same way. No finding disappears in their fixes.

**What the rule costs.** On current main it reports 3 findings, all in test helpers and none a bug. It runs in 0.26 s and does not need `.generated/`.

**So: adopt oxlint with that single rule** (config under "Recommendation"). Leave out the default rules, the Anti-Slop families and a formatter. Each costs more than it has caught. None of the 17 `pr-nits` beads is a lint or format nit.

**The formatters are safe but unearned.** Tests and typecheck pass on a fully formatted tree. But a one-time format touches 303 to 426 files, and nothing in the record shows that formatting differences have ever cost anything.

**If a formatter is wanted later, it is already installed.** The scaffold ships `oxfmt` 0.56.0 as a devDependency and commits a `grill-room/.oxfmtrc.json`, but nothing runs it. That is the framework's own convention (see "What already exists"). Start there, not with Biome.

## What already exists

- **The oxfmt install.** `grill-room/package.json` has `"oxfmt": "0.56.0"` in devDependencies. `grill-room/.oxfmtrc.json` sets `printWidth: 80`, `trailingComma: "all"` and `sortImports: true`. Both came from the scaffold commit (`b33ca30`). No script, `just` recipe or template calls oxfmt.
- **The framework's convention.** agent-native's own templates use the same tool. `node_modules/@agent-native/core/dist/templates/workspace-root/package.json` defines `"fmt:check": "oxfmt --check ."` and `"lint": "pnpm fmt:check"`. So the framework's "lint" is a format check; it ships no linter.
- **The code's current state.** It was never formatted against that config: 303 of 502 files fail `oxfmt --check` at 80 columns. Of 118,007 TS/TSX lines, 8,705 are over 80 columns, 2,788 over 100 and 1,093 over 120.
- **Stray eslint comments.** Three `eslint-disable-next-line react-hooks/exhaustive-deps` comments exist (`app/components/sessions/create-session-dialog.tsx`), though no eslint has ever run.

## Results

Machine: Darwin arm64, 14 threads. Wall time is `time.perf_counter()` around `subprocess.run` of the tool alone (`timeruns.py`, below), three runs each. Every run is logged with its exit code in `wall-times.log`.

An earlier wrapper timed through two `python3 -c` start-ups. It added about 0.23 s to every figure (0.28 s for oxlint, against 0.05 s measured directly), so its numbers are not used. All commands ran from `grill-room/`, with the tools installed in a temp directory outside the repo.

### Linters with their defaults

| Tool | Version | Command | Config | Wall time | Files | Total findings | Findings by rule |
|------|---------|---------|--------|-----------|-------|----------------|------------------|
| oxlint | 1.87.0 | `oxlint --format=json .` | none (default `correctness` category, 96 rules) | 0.054, 0.048, 0.050 s | 452 | **13** (4 production, 9 test) | no-unused-vars 8, no-useless-spread 2, no-useless-escape 2, no-unsafe-finally 1 |
| oxlint `--type-aware` | 1.87.0 + oxlint-tsgolint 7.0.2004 | `OXLINT_TSGOLINT_PATH=<tmp>/tsgolint oxlint --type-aware --format=json .` | none (111 rules) | 0.659, 0.661, 0.658 s | 452 | **34** (28 with `e2e/fixtures/**` and `.agents/**` ignored: 7 production, 21 test) | no-redundant-type-constituents 9, no-unused-vars 8, require-array-sort-compare 8, no-useless-spread 2, no-useless-escape 2, unbound-method 2, no-unsafe-finally 1, no-floating-promises 1, no-base-to-string 1 |
| oxlint `--type-aware`, before `pnpm typecheck` | same | same | none | not re-timed | 452 | 71 | no-redundant-type-constituents 46 (37 extra, all phantom); the rest identical |
| Biome lint | 2.5.15 | `biome lint --reporter=json --max-diagnostics=none .` | none | 0.366, 0.314, 0.310 s (worktree) | 467 (clean tree) | **1,184** (91 errors, 1,061 warnings, 32 info) | noNonNullAssertion 1,038, useTemplate 32, useHookAtTopLevel 26, noArrayIndexKey 19, useExhaustiveDependencies 14, noSvgWithoutTitle 9, noExplicitAny 7, noImplicitAnyLet 7, noPrototypeBuiltins 4, noDynamicNamespaceImportAccess 4, parse 4, useOptionalChain 3, useImportType 2, noLabelWithoutControl 2, useIterableCallbackReturn 2 (+9 more rules with 1 to 2 each) |

Here, "test" means a `.test.` file or anything under `e2e/` or `test/`.

**Type-aware runs need the generated types.**
- oxlint looks for `oxlint-tsgolint` in the project's `node_modules`. Run from a temp install, it fails with `Failed to find tsgolint executable. You may need to add the oxlint-tsgolint package to your project?`. Setting `OXLINT_TSGOLINT_PATH` fixes that.
- In a fresh worktree, `.generated/action-types.d.ts` does not exist until `pnpm typecheck` (or dev) writes it. Until then, every `AgentNativeActionRegistry[...]["result"]` resolves to an error type, which produces 37 phantom `'any' overrides all other types` findings.
- So a type-aware lint step that runs the default rules must run after typecheck. The single rule recommended below does not depend on the generated types: it gives the same 3 findings on a cold `git archive` tree with no `.generated/`.

**Biome needs config to run at all usefully.**
- With no config, it ignores `.gitignore` and lints whatever gitignored output the tree holds.
- A clean tree (`git archive ad7fc56` extracted into a fresh directory outside the worktree, nothing generated) gives the 1,184 above on 467 files. One earlier run on an extracted tree reported 497 files; it did not reproduce on a re-run of the same directory or on a fresh extract.
- This worktree, after typecheck, gives 1,196, adding `.react-router/` (8) and `.generated/` (4).
- The main checkout, where e2e has run, gives **7,939**. 6,743 of those are under `playwright-report/`. `test-results/` would be linted too when present; it was absent there.
- It also cannot parse Tailwind v4 directives in `app/global.css` (4 parse errors).
- The minimum config is `vcs.useIgnoreFile: true` and `css.parser.tailwindDirectives: true`.

**Two Biome rules are almost all tests or noise.** 899 of Biome's 1,038 `noNonNullAssertion` findings are in test files. All 26 `useHookAtTopLevel` errors are vitest helpers named `use*` (`useTempGitRepos()`), not React hooks.

### Anti-Slop's rule families

`docs/spikes/roundup-harvest.md` (row Anti-Slop) describes "18 syntactic Oxlint rules against type escape hatches, unsafe casts, module mocking and quadratic accumulation". Anti-Slop's own rule files were not available here, so this section runs the nearest oxlint 1.87.0 rules for each family. Everything else is switched off with `-A all`. `e2e/fixtures/**` and `.agents/**` are ignored.

| Family | oxlint rule | Total | Production | Test |
|--------|-------------|-------|------------|------|
| Type escape hatches | `typescript/no-non-null-assertion` | 1,028 | 139 | 889 |
| | `typescript/no-explicit-any` | 7 | 3 | 4 |
| | `typescript/ban-ts-comment` | 0 | 0 | 0 |
| Unsafe casts | `typescript/no-unsafe-type-assertion` (type-aware) | 284 | 100 | 184 |
| Module mocking | `vitest/no-restricted-vi-methods` set to forbid `mock` and `doMock`. It is the only rule that can ban module mocking; it needs a config file and is off by default | 5 | 0 | 5 |
| | `jest/no-mocks-import`, `jest/no-untyped-mock-factory` (with `--jest-plugin`) | 5 (all `no-untyped-mock-factory`) | 0 | 5 |
| Quadratic accumulation | `oxc/no-accumulating-spread` | 0 | 0 | 0 |
| **Core set total** (the first four rules plus `no-accumulating-spread`) | | **1,319** | **242** | **1,077** |
| Wider, for comparison (type-aware) | `no-unsafe-assignment` 146, `no-unsafe-member-access` 116, `no-unsafe-call` 32, `no-unsafe-return` 19, `no-unsafe-argument` 19, `no-await-in-loop` 111 | 1,762 with the core set | 302 | 1,460 |

The whole repo has nine `vi.mock`, `vi.spyOn` or `vi.stub*` calls, all in test files: 5 `vi.mock`, 2 `vi.spyOn`, 2 `vi.stubEnv`. No `reduce` spreads its accumulator. The 47 production `no-await-in-loop` findings are sequential filesystem walks and ordered retries.

### `typescript/no-unnecessary-type-parameters`

This rule is not one of the Anti-Slop families. It is the only rule found to catch a logged failure (see "Testing the 'zero of the delegation failures' claim"). It is type-aware and off by default, and flags a type parameter used only once in a signature. A `T` used once is a generic that throws its type away.

| Tree | Findings | Where |
|------|----------|-------|
| `11e5368` (gr-c0t.26 before its fix) | 5 | **`server/interviewer/schemas.ts:548`** "Type parameter Citation is used only once"; **`schemas.ts:549`** "Type parameter T is used only once"; plus the 3 test helpers below |
| `b59dc8c` (the fix) | 3 | the 3 test helpers only |
| `ad7fc56` (current main) | 3 | `actions/ask-consistency-findings.test.ts:61`, `server/project-facts.test.ts:50`, `server/projects.test.ts:36` |

The three findings on main are **style**, not bugs.
- `bind<T extends object>(target: T, prop)` would be the same as `(target: object, prop)`.
- `facts<T extends object>(outcome: T)` and `registered<T extends object>(outcome: T)` take a typed result and then cast it back with `as { facts: ... }`. That is the same erasure shape as the defect, but in test helpers whose casts match what the tests assert. Each fix is a one-line signature change.

Wall time is 0.278, 0.256 and 0.261 s for the single rule with `--type-aware`. It gives the same 3 findings on a cold tree with no `.generated/`.

### Formatters

| Tool | Version | Command | Config | Wall time | Files that would change | Format diff (`git diff --shortstat`) | `pnpm test` after | `pnpm typecheck` after |
|------|---------|---------|--------|-----------|-------------------------|--------------------------------------|-------------------|------------------------|
| oxfmt | 0.72.0 | `oxfmt --check .` | committed `.oxfmtrc.json` (found automatically) | 0.075, 0.059, 0.055 s | 303 of 502 | 303 files, +19,680 / −6,588 (214 ts, 67 tsx, 20 md, 1 json, 1 css; 25 under `.agents/` or `e2e/fixtures/`) | exit 0: 122 files, 3,407 tests passed | exit 0 |
| oxfmt, pure defaults | 0.72.0 | `oxfmt -c <empty {}> --check .` | none (printWidth 100, no import sort) | 0.055, 0.053, 0.056 s | 343 of 502 | 343 files, +6,934 / −7,325 | not run | not run |
| oxfmt, repo-pinned | 0.56.0 | `node_modules/.bin/oxfmt --check .` | committed `.oxfmtrc.json` | 0.919, 0.453, 0.447 s | 301 of 502 | not applied | not run | not run |
| Biome format | 2.5.15 | `biome format --reporter=json --max-diagnostics=none .` on the clean tree; timed with `--max-diagnostics=0` | none (tabs, width 80) | 0.110, 0.110, 0.111 s | 427 of 459 checked, plus 4 CSS parse errors | 426 files, +110,526 / −97,453 | exit 0: 122 files, 3,407 tests passed | exit 0 |
| Biome format, spaces | 2.5.15 | `biome format --indent-style=space --write .` | `--indent-style=space` only | not timed | not counted | 274 files, +19,167 / −6,094 | not run | not run |

Each trial wrote the formatter's changes onto the worktree, saved the diff, and ran typecheck and test with `; echo "exit=$?"` appended to their logs. `git checkout -- grill-room/` then restored the tree, and `git status --short` was empty afterwards. No formatter created a new file.

On the worktree, `biome format --max-diagnostics=0 .` prints `Checked 479 files ... Found 450 errors`. That count includes the generated dirs; the clean-tree JSON summary is the 459 above.

### How far the defaults are from the current style

Quotes, semicolons and trailing commas already match all three tools: the code uses double quotes, semicolons and trailing commas everywhere. In the oxfmt diff, only 5 distinct added lines are quote-only changes, 3 add a semicolon and 3 add a comma. Nearly all the difference is **line width** for oxfmt and **indentation** for Biome. In the 80-column oxfmt diff, 6,492 of the 19,680 added lines are an existing line re-indented inside a new wrap.

oxfmt with the committed config (width 80) wraps lines that the code wrote at about 90 columns:

```diff
-    return refuse("folder-not-found", `The project root does not exist: ${resolved}`);
+    return refuse(
+      "folder-not-found",
+      `The project root does not exist: ${resolved}`,
+    );
```

oxfmt defaults (width 100) join lines that the code wrapped at 80, so the code is inconsistent with both widths:

```diff
-import {
-  ConfirmedPanel,
-  DoneProposedPanel,
-} from "@/components/workspace/done-panel";
+import { ConfirmedPanel, DoneProposedPanel } from "@/components/workspace/done-panel";
```

Biome defaults re-indent every line with tabs:

```diff
-  schema: z.object({
-    decisionId: z.string().min(1).describe("Decision id"),
-    adrWorthy: z
+	schema: z.object({
+		decisionId: z.string().min(1).describe("Decision id"),
```

## Classified sample: default rules

32 findings, spread over every rule that fired in oxlint and the 15 largest Biome rules. Each was read in place at `ad7fc56`. "Real bug" means the code does the wrong thing today. None qualified.

| # | Tool, rule | Location | Class | Why |
|---|-----------|----------|-------|-----|
| 1 | oxlint no-unsafe-finally (Biome noUnsafeFinally too) | `server/e2e-warm-up.ts:335` | noise | The throw in `finally` is guarded by `if (!failure)`. It surfaces a cleanup failure only when the warm-up itself succeeded, as the comment says. |
| 2 | oxlint no-useless-escape (Biome noUselessEscapeInString) | `server/handoff.ts:1123` | style | `` \` `` inside a double-quoted string within a template expression; the output is identical. |
| 3 | oxlint no-unused-vars | `app/components/workspace/round-nudge.tsx:12` | noise | `ROUND_NUDGE_THRESHOLD` is imported for the JSDoc `{@link}` at line 41. |
| 4 | oxlint no-unused-vars | `actions/set-adr-worthy.test.ts:300` | noise | Destructure-to-omit (`({ adrWorthy, consequences, ...rest }) => rest`); the default lacks `ignoreRestSiblings`. 5 of the 8 findings are this. |
| 5 | oxlint no-unused-vars (Biome noUnusedImports) | `actions/remove-rule-waiver.test.ts:16` | style | Dead `previewExport` import in a test. |
| 6 | oxlint no-unused-vars (Biome noUnusedVariables) | `actions/export-session.test.ts:768` | style | Leftover `bundleDir`; the assertions compare against `result.written` directly, so nothing is missing. |
| 7 | oxlint no-useless-spread | `server/decisions-file.test.ts:179` | style | `...{ introducedBy, repo }` spread of an object literal in a fixture. |
| 8 | oxlint require-array-sort-compare | `actions/export-session.test.ts:1908` | style, latent | `groundedBriefs.sort()` on numbers sorts as strings: right for `[1, 2]`, wrong from 10 up. Test-only. |
| 9 | oxlint require-array-sort-compare | `actions/register-project.test.ts:183` | noise | Sorts `[id, folder]` pairs only to compare them regardless of order; string order is deterministic. |
| 10 | oxlint no-floating-promises | `app/components/output/consistency-section.tsx:412` | noise | React Router's `navigate()` in an `onSuccess`; there is nothing to await. |
| 11 | oxlint unbound-method | `app/components/output/build-records-section.tsx:17` | noise | `useFormatters()` returns closures over `locale`; `formatNumber` never reads `this`. |
| 12 | oxlint unbound-method | `actions/break-into-tickets.test.ts:1925` | noise | `fake.breakIntoTickets` is an arrow-function property (`server/interviewer/fake.ts:594`). |
| 13 | oxlint no-base-to-string | `app/components/workspace/brief-strip.test.tsx:37` | noise | Test-only `realT` helper; every caller passes strings or numbers. |
| 14 | oxlint no-redundant-type-constituents | `server/interviewer/prompt.ts:215` | style | `unknown \| null` is just `unknown`. |
| 15 | oxlint no-redundant-type-constituents | `e2e/fixtures/demo-project/grill-room/server/export-bundle.ts:148` | noise | A fixture copy whose imports do not resolve; it should be ignored, not linted. 6 of the 9 are fixture files. |
| 16 | oxlint no-redundant-type-constituents, cold tree | `app/components/output/export-section.tsx:104` | noise | Only appears before `.generated/` exists; 37 such findings vanish after typecheck. |
| 17 | Biome useHookAtTopLevel (error) | `actions/assess-readiness.test.ts:20` | noise | `useTempGitRepos()` is a vitest helper, not a React hook. All 26 are this. |
| 18 | Biome noNonNullAssertion | `actions/break-into-tickets.ts:193` | style | `session!.id` after a lookup the action already guarded. |
| 19 | Biome useExhaustiveDependencies | `app/components/sessions/create-session-dialog.tsx:131` | noise | A deliberate open-only effect that reads refs, already marked `eslint-disable-next-line react-hooks/exhaustive-deps`. |
| 20 | Biome useExhaustiveDependencies | `app/components/output/build-record-form.tsx:126` | noise | Keyed on `record?.updatedAt` by design, to re-sync when the stored record changes (comment above it). |
| 21 | Biome useIterableCallbackReturn | `app/components/workspace/markdown.tsx:19` | noise | A `switch` over a closed `InlineNode` union where every case returns; TypeScript proves it exhaustive. |
| 22 | Biome useIterableCallbackReturn | `app/components/output/tickets-section.tsx:118` | style | `forEach((n) => map.set(...))` returns the Map, which is ignored. |
| 23 | Biome noArrayIndexKey | `app/components/workspace/markdown.tsx:22` | noise | Parsed markdown nodes, rendered from scratch for each text and never reordered. |
| 24 | Biome noAssignInExpressions | `server/export-bundle.ts:1008` | style | The `(history[id] ??= []).push(...)` idiom. |
| 25 | Biome noPrototypeBuiltins | `server/interviewer/fake.ts:280` | style | `Object.prototype.hasOwnProperty.call(...)` is already the safe form; Biome prefers `Object.hasOwn`. |
| 26 | Biome noImplicitAnyLet | `server/projects.ts:157` | noise | `let stats;` assigned in a `try`; TypeScript's control flow types it, and typecheck passes. |
| 27 | Biome noDangerouslySetInnerHtml | `app/root.tsx:69` | noise | An inline constant theme-init script, with no user input. |
| 28 | Biome useAriaPropsSupportedByRole | `app/components/workspace/brief-strip.tsx:227` | style (a11y) | `aria-label` on a span with no role is ignored by screen readers; the full summary text is still in the DOM, since truncation is CSS only. |
| 29 | Biome noLabelWithoutControl | `app/components/output/export-file-list.tsx:66` | noise | The label wraps a Radix `Checkbox`, which renders a `button`, a labelable element. |
| 30 | Biome parse | `app/global.css:10` | noise | Tailwind v4 directives; needs `css.parser.tailwindDirectives`. |
| 31 | Biome noShadowRestrictedNames | `server/interviewer/claude-cli.test.ts:87` | style | A test helper named `valueOf`. |
| 32 | Biome noExplicitAny | `vite.config.ts:7` | style | The scaffold's cast of the plugin factories. |

## Classified sample: Anti-Slop-equivalent rules, production code

16 production findings, spread over the four rules that fired in production, read in place. None is a real bug, so no test coverage question arises.

| # | Rule | Location | Class | Why |
|---|------|----------|-------|-----|
| A1 | no-unsafe-type-assertion | `server/interviewer/claude-cli.ts:598` | noise | The `turn()` result cast to `InterviewerTurn<ResultFor<K>>`; `turn` has already validated it against `resultSchemas[request.kind]` (line 522). There are 9 such casts at lines 598–645, and 9 more at `fake.ts:573`–`620`. |
| A2 | no-unsafe-type-assertion | `server/interviewer/claude-cli.ts:481` | style | `JSON.parse(stdout) as CliEnvelope`; the envelope's fields are then read through `typeof` checks (`usageOf`, line 379). |
| A3 | no-unsafe-type-assertion | `server/interviewer/claude-cli.ts:486` | noise | `(error as Error).message` in a `catch` around `JSON.parse`, which only throws `SyntaxError`. |
| A4 | no-unsafe-type-assertion | `server/projects.ts:402` | style | `JSON.parse(source) as { scripts?: unknown }`; `scripts` is checked with `typeof` on the next lines. |
| A5 | no-unsafe-type-assertion | `server/projects.ts:508` | noise | `kind as ProjectTrackerKind` inside the true branch of `PROJECT_TRACKER_KINDS.includes(kind)`; lines 517 and 526 are the same guard for other enums. |
| A6 | no-unsafe-type-assertion | `server/projects.ts:552` | noise | `(patch as string).trim()` in the false branch of `blank(patch)`, which rules out null and undefined. |
| A7 | no-unsafe-type-assertion | `server/tree.ts:275` | noise | `answerKind as LooseEndReason` right after `LOOSE_END_ANSWER_KINDS.includes(...)`. |
| A8 | no-unsafe-type-assertion | `server/handoff.ts:2183` | style | `JSON.parse(row.atJson) as ConsistencyPlace` reads a column only the app writes, from a validated shape. The same pattern is at `server/consistency.ts:409` and `actions/ask-consistency-findings.ts:104`. |
| A9 | no-unsafe-type-assertion | `server/scout-report.ts:127` | style | `row.model as InterviewerModel`; the text column is written only from the validated enum. |
| A10 | no-unsafe-type-assertion | `server/export.ts:241` | noise | `file as Record<string, unknown>` after `typeof file === "object" && file !== null`; both fields are then type-checked. |
| A11 | no-unsafe-type-assertion | `app/lib/session-draft.ts:35` | noise | `parsed as Record<string, unknown>` after an object and non-array check; each field is then matched against known values. |
| A12 | no-unsafe-type-assertion | `app/routes/sessions.$sessionId.tsx:394` | noise | `round.submittedAt as string` after `.filter(... && round.submittedAt)`. |
| A13 | no-non-null-assertion | `server/handoff.ts:151` | noise | `numbers[numbers.length - 1]! + 1`; line 148 returns early when `tickets.length === 0`. |
| A14 | no-non-null-assertion | `server/handoff.ts:1917` | style | `grounding!` after `groundingEntryFor(grounding, ticket)` returned an entry, which needs a grounding; the narrowing is lost across the call. |
| A15 | no-non-null-assertion | `server/tickets.ts:294` | noise | `byNumber.get(number)!` while iterating `byNumber.keys()`. |
| A16 | no-explicit-any | `app/hooks/use-navigation-state.ts:76` | style | `pathForCommand(command: any)`; every field is read through `typeof ... === "string"` checks. |

The wider set's production-only additions are style or noise of the same kinds: `no-unsafe-*` on parsed JSON that is then type-checked, and `no-await-in-loop` on deliberate sequential walks such as `server/export-bundle.ts:471`, which walks up to the nearest existing directory.

## Testing the "zero of the delegation failures" claim

**Which rows count.** `docs/spikes/roundup-harvest.md` says Anti-Slop's rules would have caught none of the roughly 35 logged failures. The log now has 211 rows:
- 80 rows have a first attempt marked "No" or "Revised to NO".
- 2 more failed without a plain "No": gr-qs7.5 ("Partly: 4 of 5 checks pass") and the workflow arm of gr-5e7.13 ("Workflow arm no").

All 82 were checked.

**What they are.**
- review-found logic holes: retry revival, deadline order, stale flags, `check-ignore` path forms;
- tests that survive a revert;
- prompt and spec contradictions;
- migrations;
- seams between tickets;
- process failures: a background verify, a classifier block, a missing executable bit, a stray `pnpm-workspace.yaml` edit;
- for gr-qs7.5, a model ignoring a prompt rule;
- for gr-5e7.13, an ambiguous ticket.

**The word scan.** Every failure row was grepped for the four families' words: any, non-null, unknown, cast, type assertion, mock, quadratic, accumulate, spread. That gave 38 hits; the scan output is saved in the evidence. Two hits are about code:
- gr-c0t.31: "a spread that always adds the field". This is a test blind to a spread, not accumulation.
- gr-c0t.26, below.

**gr-c0t.26 is caught, by `typescript/no-unnecessary-type-parameters`.**
- **The defect.** In gr-c0t.26 (PR #137), "a slot helper erased the proposal types to `unknown`". The pre-fix code is commit `11e5368` and the fix is `b59dc8c`, both in `grill-room/server/interviewer/schemas.ts`.
- **How the erasure works.** The pre-fix code is a parameter annotation, `slot: <T extends z.ZodType>(shape: T) => z.ZodType` (line 549). It returns the base `ZodType`, so the inferred output is `unknown`. There is no `as` and no `any`.
- **The test.** Both commits were extracted with `git archive` into scratch directories and typechecked so `.generated/` existed (exit 0 each). Both were then linted with all 111 `typescript/*` rules, type-aware, everything else off.
- **The result.** 5,624 findings before the fix and 5,622 after. Keyed by file, rule and message, the whole difference is two findings, both of `no-unnecessary-type-parameters` in `schemas.ts`:
  - `548` "Type parameter Citation is used only once in the function signature";
  - `549` "Type parameter T is used only once in the function signature".
- **No other rule moves on that change.**
- **Why the earlier runs missed it.** The default type-aware set (19 = 19) and the Anti-Slop sets (1,397 = 1,397) do not include this rule. Those sets target `any`, assertions and non-null. A generic whose type parameter is used once is a different signal.
- **Would it have saved a review round? No.** Review round 1 of gr-c0t.26 had two other blockers, a wrong AGENTS.md line and five untested prompt clauses. The lint would have removed one of three findings before review, not the round.

**The other type- and schema-shaped failures.** Five more of the 82 are about types, schemas or columns and have a pre-fix commit on their PR. Each pair was extracted, typechecked (exit 0) and run with all `typescript/*` rules:

| Failure | Before → after | Findings | What changed |
|---------|----------------|----------|--------------|
| gr-7jg.3, attempt kind stored as null (PR #14) | `e151302` → `f697f40` | 2,072 → 2,078 | only new test lines (`no-non-null-assertion`, `no-unnecessary-type-assertion` in `request-next-round.test.ts`) |
| gr-c0t.14, dropped usage and 32-bit INTEGER columns (PR #99) | `9fdbdfd` → `c75fd91` | 4,221 → 4,230 | only new test lines in `claude-cli.test.ts` and `turn-records.test.ts` |
| gr-c0t.8 + .12, a shape rule and fixtures as evidence (PR #129) | `bed7414` → `0fc60f5` | 5,541 → 5,541 | none |
| gr-c0t.25, proposals schema untested (PR #134) | `12558d0` → `42f8637` | 5,585 → 5,585 | none |
| gr-c0t.32, filter on the wrong column untested (PR #141) | `89cefff` → `eb776bf` | 5,798 → 5,798 | none |

No finding disappears with any of these fixes, so no rule catches them.

**The claim fails at 1 of 82.** No default rule set and no Anti-Slop family catches any failure. `typescript/no-unnecessary-type-parameters` catches gr-c0t.26.

**Elsewhere in the record.** None of the 17 `pr-nits` beads (`bd list --label pr-nits --all`) is a lint, format, cast, `any` or mocking nit. What the linters find that reviewers did not: 2 dead imports, 1 dead variable, 2 useless escapes and spreads. None of them changes behaviour.

## Vite+

**What it is.** `vite-plus` is at 1.1.0 on npm (`latest`; no longer a beta), MIT. `vp --version` reports vite 8.3.3, rolldown 1.2.12, vitest 5.0.3 and oxfmt 0.72.0. The package pins `oxlint` 1.87.0 and `oxlint-tsgolint` 7.0.2003. These are the same binaries measured above, with the same output: `vp lint .` in `grill-room/` printed the same 13 findings.

**`vp lint` can sit beside agent-native.** It works from a temp install with no project change. It forwards to oxlint and adds nothing over calling oxlint directly.

**`vp fmt` cannot, without wiring.**
- Run against `grill-room/`, it handed off to the project's own oxfmt 0.56.0. That oxfmt then tried to load `vite.config.ts` as its config and failed: `Cannot find package 'vite-plus' imported from .../oxfmt@0.56.0/.../cli.js`.
- Vite+ wants the `fmt` and `lint` blocks inside `vite.config.ts`, using `defineConfig` from `vite-plus`, and its docs advise against `.oxfmtrc.json`.
- That file belongs to agent-native: it imports `agentNative` from `@agent-native/core/vite` and `defineConfig` from `vite`.

**A full `vp migrate` would fight agent-native.** Per `docs/guide/migrate-rules.md` in the package, it:
- points the existing `vite` dependency at `@voidzero-dev/vite-plus-core` (vite 8.3.3), where grill-room pins `vite` 8.1.0 to match `@agent-native/core` 0.182.1's template;
- moves vitest to 5.0.3, where the suite and `@stryker-mutator/vitest-runner` 10.0.0 are on vitest 4.1 (the runner's own dev dependency is 4.1.10);
- rewrites `vitest` imports to `vite-plus/test*`;
- adds `vite@*` and `vitest@*` overrides to `pnpm-workspace.yaml`;
- regenerates the lockfile.

agent-native's CLI resolves the project's `vite` binary for `dev` (`findViteBin()` in `dist/cli/index.js`). For `typecheck` it runs `react-router typegen` and then `tsc --noEmit`, and `build` goes through `react-router build`. All three would then run on a Vite that agent-native did not ship with, and the next agent-native upgrade would contend with the overrides. Vite+ brings nothing here that oxlint and oxfmt do not already bring on their own, and it costs a toolchain migration.

## Recommendation

**Adopt only a linter: oxlint, type-aware, with exactly one rule, `typescript/no-unnecessary-type-parameters`.** No formatter, no default rules, no Anti-Slop families, no Biome.

**The evidence.**
- **Catches:** 1 of 82 failed first attempts, gr-c0t.26. This rule fires on the erasure at `11e5368` and goes silent with the fix. It is the only one of 111 `typescript/*` rules whose findings change, and five other type- or schema-shaped failures show no rule catching them.
- **Cost on current code:** 3 findings, all test helpers, all style. Each is a one-line signature change to fix, with no suppression needed. After that the rule stays at 0 until someone writes a generic that discards its type parameter: the shape of the logged defect.
- **Runtime:** 0.26 s per run. It needs `oxlint-tsgolint` installed beside `oxlint`, but it does not need `.generated/`, so it can run before or after typecheck.
- **Everything else measured catches nothing:** 0 real bugs among 13 default oxlint findings, 34 type-aware, 1,184 Biome and 1,319 Anti-Slop-equivalent (242 production). 48 findings were sampled and read in place.
- **Each wider set costs more than it can show.** Default `correctness` adds 13 findings to fix and the type-aware defaults 34. The Anti-Slop families add 242 production findings, almost all casts that the next line or a schema has already checked. None of these maps to a logged failure.
- **Formatting is safe** (3,407 tests and typecheck exit 0 on both formatted trees), but nothing in the record shows a cost it would remove. Its one-time price is a 303-file commit.

**Why adopt on one catch.** It is a weak case, and that should be plain:
- The catch would not have saved gr-c0t.26 a review round, since the round had two other blockers.
- What it buys is that a builder sees this one defect class before review, for 0.26 s and three one-line test fixes. The rule targets exactly the shape of a defect that reached review.
- Every other candidate was measured against the same record and caught nothing.

If the owner weighs one catch in 82 as too little, "adopt nothing yet" is the alternative; it costs nothing to keep. A formatter stays out either way.

**Config** (`grill-room/.oxlintrc.json`):

```json
{
  "categories": { "correctness": "off" },
  "rules": { "typescript/no-unnecessary-type-parameters": "error" },
  "ignorePatterns": ["e2e/fixtures/**", ".agents/**"]
}
```

Tested as written, through `-c`, on `ad7fc56`: 3 findings, exit 1.

**Wiring.**
- `package.json` devDependencies get `"oxlint": "1.87.0"` and `"oxlint-tsgolint": "7.0.2004"`.
- The script is `"lint": "oxlint --type-aware"`.
- `justfile` gets a recipe, `lint:` running `pnpm lint`, and `check: typecheck lint test e2e`.
- The verify commands a builder runs become `pnpm test`, `pnpm typecheck` and `pnpm lint` from `grill-room/`, named in `.claude/rules/worktrees.md` ("The subagent") and the builder template.
- It does not join `pnpm test`: vitest stays focused, and Stryker reuses it.

**Adoption cost.**

| Item | Cost |
|------|------|
| Dependencies | two devDependencies (`oxlint` 1.87.0, `oxlint-tsgolint` 7.0.2004); `pnpm-lock.yaml` regenerates |
| Config | `.oxlintrc.json`, 5 lines (above) |
| Scripts | one `package.json` script, one `justfile` recipe, `lint` added to `check` |
| Process | one line in `.claude/rules/worktrees.md` and the builder template's verify list |
| One-time fixes | 3 test-helper signatures: `actions/ask-consistency-findings.test.ts:61`, `server/project-facts.test.ts:50`, `server/projects.test.ts:36` |
| Per run | 0.26 s |
| Conflicts | none: no format commit. `gh pr list --repo jisequilla/grill-room --state open` returned none before this PR |

**What would widen it.**
- Another logged failure that a named rule catches. Add that rule, measured the same way: before and after the fix, then its cost on main.
- The owner deciding that diff noise from inconsistent wrapping costs review attention. oxfmt is then the step, with the costs measured above: 303 files at width 80, no new dependency, land between waves.

Biome is the worse fit:
- It needs a config just to run cleanly; with none, it reports 7,939 findings on a checkout where e2e has run.
- Its defaults re-indent 426 files with tabs.
- Its largest rules (`noNonNullAssertion`, `useHookAtTopLevel`) are noise in this codebase.
- It competes with oxfmt, the formatter agent-native already picked.

## Process

- **Manifests unchanged.** No `grill-room/package.json`, `pnpm-lock.yaml` or `pnpm-workspace.yaml` change. `node_modules` was installed with `pnpm install --frozen-lockfile` (pnpm 10.29.1, as the project pins), and the tools were installed with npm into the session scratchpad.
- **Pre- and post-fix trees.** These are `git archive` extracts in the scratchpad, with `node_modules` symlinked to the worktree's. They were typechecked with `node_modules/.bin/agent-native typecheck`.
- **Guard refusals.** The worktree-isolation guard refused several compound commands (loops, `/usr/bin/time`, unquoted globs, runtime-built `sed` ranges), each before running anything. Each was re-run as the separate plain command the refusal asked for, or moved into a helper script.

## Reproduce

Raw output and the helper scripts are in the main checkout's `.scratch/evidence/gr-rn6/` (not committed); the scripts are in its `scripts/` folder. Below, `EV` is that folder and `S` is `$EV/scripts`. The scripts carry this session's tool paths at the top (`TOOLS`, `BIOME`, `ROOT`); edit those to rerun elsewhere.

```bash
# tools, outside the repo
T=$(mktemp -d) && (cd "$T" && echo '{"private":true}' > package.json \
  && npm install oxlint@1.87.0 oxlint-tsgolint@7.0.2004 oxfmt@0.72.0 @biomejs/biome@2.5.15 vite-plus@1.1.0)
B="$T/node_modules/.bin"
cd grill-room && pnpm install --frozen-lockfile

# wall times: three runs each, child process only, appended with exit codes to $EV/wall-times.log
python3 -I $S/timeruns.py oxlint-plain 3 $EV/wall-times.log -- "$B/oxlint" --format=json .
python3 -I $S/timeruns.py oxlint-type-aware 3 $EV/wall-times.log -- "$B/oxlint" --type-aware --format=json .   # sets OXLINT_TSGOLINT_PATH
python3 -I $S/timeruns.py oxfmt-check 3 $EV/wall-times.log -- "$B/oxfmt" --check .
python3 -I $S/timeruns.py oxfmt-check-defaults 3 $EV/wall-times.log -- "$B/oxfmt" -c $S/empty-oxfmtrc.json --check .
python3 -I $S/timeruns.py oxfmt-0.56-check 3 $EV/wall-times.log -- node_modules/.bin/oxfmt --check .
python3 -I $S/timeruns.py biome-lint 3 $EV/wall-times.log -- "$B/biome" lint --reporter=json --max-diagnostics=none .
python3 -I $S/timeruns.py biome-format-check 3 $EV/wall-times.log -- "$B/biome" format --max-diagnostics=0 .

# default linters, counts by rule and production/test split
"$B/oxlint" --format=json . > $EV/oxlint-plain-ad7fc56.json
OXLINT_TSGOLINT_PATH="$B/tsgolint" "$B/oxlint" --type-aware --format=json . > cold.json   # before .generated/ exists: 71
pnpm typecheck
OXLINT_TSGOLINT_PATH="$B/tsgolint" "$B/oxlint" --type-aware --format=json . > ta.json   # 34
bash $S/antislop.sh $EV/oxlint-typeaware-ad7fc56.json "$PWD" default-ta                  # 28, fixtures and .agents ignored
python3 -I $S/count_oxlint.py $EV/oxlint-plain-ad7fc56.json

# Biome lint on a clean tree, on this worktree, and on the main checkout (gitignored dirs counted by top-level directory)
C=$(mktemp -d) && git archive ad7fc56 grill-room | tar -x -C "$C"                       # outside the worktree
python3 -I $S/biome_dirs.py "$C/grill-room" $EV/biome-lint-clean2-ad7fc56.json                # 1,184 on 467 files
python3 -I $S/biome_dirs.py . $EV/biome-lint-worktree-ad7fc56.json                            # 1,196 (.react-router 8, .generated 4)
python3 -I $S/biome_dirs.py <main checkout>/grill-room $EV/biome-lint-main-checkout.json      # 7,939 (playwright-report 6,743)
(cd "$C/grill-room" && "$B/biome" format --reporter=json --max-diagnostics=none . > $EV/biome-format-clean-ad7fc56.json)   # 427 of 459

# Anti-Slop-equivalent rules (core: 1,319; extended: 1,762; mock+accumulation: 5; vi.mock ban: 5)
bash $S/antislop.sh $EV/antislop-core.json "$PWD" core
bash $S/antislop.sh $EV/antislop-extended.json "$PWD" extended
bash $S/antislop.sh $EV/antislop-mockaccum.json "$PWD" mockaccum
"$B/oxlint" -c $S/oxlint-nomock.json --format=json . > $EV/antislop-nomock.json
python3 -I $S/count_oxlint.py $EV/antislop-core.json no-unsafe-type-assertion   # totals, split, production list
git grep -n -E 'vi\.(mock|doMock|spyOn|stubGlobal|stubEnv)\(' -- . > $EV/vi-mock-uses.txt

# gr-c0t.26 before and after the fix
for c in 11e5368 b59dc8c; do mkdir -p tree-$c && git archive $c grill-room | tar -x -C tree-$c \
  && ln -s "$PWD/node_modules" tree-$c/grill-room/node_modules \
  && (cd tree-$c/grill-room && node_modules/.bin/agent-native typecheck); done
bash $S/antislop.sh $EV/prefix-11e5368-antislop-extended.json tree-11e5368/grill-room extended
bash $S/antislop.sh $EV/postfix-b59dc8c-antislop-extended.json tree-b59dc8c/grill-room extended
bash $S/antislop.sh $EV/prefix-11e5368-default-ta.json tree-11e5368/grill-room default-ta
bash $S/antislop.sh $EV/postfix-b59dc8c-default-ta.json tree-b59dc8c/grill-room default-ta
python3 -I $S/diff_findings.py $EV/prefix-11e5368-antislop-extended.json $EV/postfix-b59dc8c-antislop-extended.json   # before=1397 after=1397
python3 -I $S/diff_findings.py $EV/prefix-11e5368-default-ta.json $EV/postfix-b59dc8c-default-ta.json                 # before=19 after=19

# every typescript/* rule (111, listed from oxlint's configuration_schema.json into $S/ts-rules.txt), and the one rule
python3 -I -c "import json,re;s=json.dumps(json.load(open('$T/node_modules/oxlint/configuration_schema.json')));print('\n'.join(sorted(set(re.findall(r'\"(typescript/[a-z0-9-]+)\"',s)))))" > $S/ts-rules.txt
bash $S/tsall.sh $EV/prefix-11e5368-tsall.json tree-11e5368/grill-room $S/ts-rules.txt
bash $S/tsall.sh $EV/postfix-b59dc8c-tsall.json tree-b59dc8c/grill-room $S/ts-rules.txt
python3 -I $S/diff_findings.py $EV/prefix-11e5368-tsall.json $EV/postfix-b59dc8c-tsall.json   # 5624 -> 5622: only no-unnecessary-type-parameters, schemas.ts:548, :549
echo typescript/no-unnecessary-type-parameters > $S/rule-nutp.txt
bash $S/tsall.sh $EV/nutp-11e5368.json tree-11e5368/grill-room $S/rule-nutp.txt   # 5
bash $S/tsall.sh $EV/nutp-b59dc8c.json tree-b59dc8c/grill-room $S/rule-nutp.txt   # 3
bash $S/tsall.sh $EV/nutp-ad7fc56.json "$PWD" $S/rule-nutp.txt                    # 3, all test helpers

# the other type/schema failures: archive each pre/post commit to $S/t-<sha>.tar, then
for c in e151302 f697f40 9fdbdfd c75fd91 bed7414 0fc60f5 12558d0 42f8637 89cefff eb776bf; do
  git archive --format=tar --output=$S/t-$c.tar $c grill-room && bash $S/pair_tsall.sh $c; done
bash $S/pairs.sh                                     # per-pair diffs into $EV/tsall-diff-<bead>.txt

# the recommended config, on main, timed, and on a cold tree
OXLINT_TSGOLINT_PATH="$B/tsgolint" "$B/oxlint" --type-aware -c $S/oxlintrc-proposed.json .   # 3 findings, exit 1
python3 -I $S/timeruns.py proposed-lint 3 $EV/wall-times.log -- "$B/oxlint" --type-aware -c $S/oxlintrc-proposed.json .

# format trials: apply, measure, verify with exit codes, restore (repeat per formatter)
"$B/oxfmt" --write .      # or: "$B/oxfmt" -c $S/empty-oxfmtrc.json --write . | "$B/biome" format --write . | "$B/biome" format --indent-style=space --write .
git diff --shortstat && git diff --output=$EV/oxfmt-format.diff
pnpm typecheck > $EV/oxfmt-typecheck.out 2>&1; echo "exit=$?" >> $EV/oxfmt-typecheck.out
pnpm test > $EV/oxfmt-test.out 2>&1; echo "exit=$?" >> $EV/oxfmt-test.out
git checkout -- . && git status --short

# derived counts: Biome top 15 with test split, Biome format 427/459, per-diff file types,
# .agents/ + e2e/fixtures/ files, re-indented lines, quote/semicolon/comma changes
python3 -I $S/counts.py $EV > $EV/counts.txt

# line widths
git ls-files -- '*.ts' '*.tsx' | xargs awk '{l=length($0); t++; if(l>80)a++; if(l>100)b++; if(l>120)c++} END{print t,a,b,c}'

# delegation failures: 80 strict + 2 partial, and the four-family word scan
python3 -I $S/failures.py ../docs/delegation-log.md > $EV/delegation-failures-count.txt
python3 -I $S/failures.py ../docs/delegation-log.md --scan > $EV/delegation-failures-antislop-scan.txt
bd list --label pr-nits --all --json > $EV/pr-nits-beads.json   # 17

# Vite+
"$B/vp" --version
"$B/vp" lint .            # 13 findings
"$B/vp" fmt --check .     # fails: Cannot find package 'vite-plus' imported from oxfmt@0.56.0

# open PRs
gh pr list --repo jisequilla/grill-room --state open
```
