# Spike: a linter and formatter for grill-room

Bead gr-rn6. grill-room runs typecheck, vitest, mutation testing, Playwright and doctor, but no lint step and no format step. This spike runs oxlint, oxfmt and Biome on `grill-room/` with default settings. It classifies what they find, measures what a one-time format would change, and checks whether Vite+ could sit beside agent-native's CLI.

## Verdict: adopt nothing yet

The linters found **zero real bugs**. oxlint (plain and type-aware) and Biome found 1,193 issues between them. Every one sampled was style or noise. None of the 80 first-attempt delegation failures in `docs/delegation-log.md` is the kind a lint rule catches, and none of the 16 `pr-nits` beads is a lint or format nit. The formatters are safe: tests and typecheck pass on a fully formatted tree. But a one-time format touches 303 to 426 files, and nothing in the record shows that formatting differences have ever cost anything.

The cheapest path is already installed. The scaffold ships `oxfmt` 0.56.0 as a devDependency, along with a committed `grill-room/.oxfmtrc.json`, but no script runs it. That is the framework's own convention (see "What already exists"). If a trigger below fires, start there, not with Biome.

## What already exists

- `grill-room/package.json` has `"oxfmt": "0.56.0"` in devDependencies, and `grill-room/.oxfmtrc.json` sets `printWidth: 80`, `trailingComma: "all"`, `sortImports: true`. Both came from the scaffold commit (`b33ca30`). No script, `just` recipe or template calls oxfmt.
- agent-native's own templates use the same tool: `node_modules/@agent-native/core/dist/templates/workspace-root/package.json` defines `"fmt:check": "oxfmt --check ."` and `"lint": "pnpm fmt:check"`. The framework's "lint" is a format check. It ships no linter.
- The code was never formatted against that config. At 80 columns, 303 of 502 files fail `oxfmt --check`. Of 116,619 TS/TSX lines, 8,596 are over 80 columns, 2,763 over 100 and 1,082 over 120.
- Three `eslint-disable-next-line react-hooks/exhaustive-deps` comments exist (`app/components/sessions/create-session-dialog.tsx`), though no eslint has ever run.

## Results

Machine: Darwin arm64, 14 threads. Wall time comes from a wrapper that times the process. Each tool ran twice; both times are shown. All commands were run from `grill-room/`, with the tools installed in a temp directory outside the repo.

### Linters

| Tool | Version | Command | Config | Wall time | Files | Total findings | Findings by rule |
|------|---------|---------|--------|-----------|-------|----------------|------------------|
| oxlint | 1.87.0 | `oxlint --format=json .` | none (default: `correctness` category, 96 rules) | 0.28 s, 0.29 s | 452 | **13** | no-unused-vars 8, no-useless-spread 2, no-useless-escape 2, no-unsafe-finally 1 |
| oxlint `--type-aware` | 1.87.0 + oxlint-tsgolint 7.0.2004 | `OXLINT_TSGOLINT_PATH=<tmp>/tsgolint oxlint --type-aware --format=json .` | none (111 rules) | 1.00 s, 0.91 s | 452 | **34** | no-redundant-type-constituents 9, no-unused-vars 8, require-array-sort-compare 8, no-useless-spread 2, no-useless-escape 2, unbound-method 2, no-unsafe-finally 1, no-floating-promises 1, no-base-to-string 1 |
| oxlint `--type-aware`, before `pnpm typecheck` | same | same | none | 1.69 s, 0.86 s | 452 | 71 | no-redundant-type-constituents 46 (37 extra, all phantom), rest identical |
| Biome lint | 2.5.15 | `biome lint --reporter=json --max-diagnostics=none .` | none | 0.60 s, 0.62 s | 467 | **1,159** (91 errors, 1,036 warnings, 32 info) | noNonNullAssertion 1,013, useTemplate 32, useHookAtTopLevel 26, noArrayIndexKey 19, useExhaustiveDependencies 14, noSvgWithoutTitle 9, noExplicitAny 7, noImplicitAnyLet 7, noPrototypeBuiltins 4, noDynamicNamespaceImportAccess 4, parse 4, useOptionalChain 3, useImportType 2, noLabelWithoutControl 2, useIterableCallbackReturn 2 (+9 more rules with 1 to 2 each) |

Notes on running them:
- **Type-aware needs the generated types.** oxlint looks for `oxlint-tsgolint` in the project's `node_modules`. Run from a temp install, it fails with `Failed to find tsgolint executable. You may need to add the oxlint-tsgolint package to your project?`. Setting `OXLINT_TSGOLINT_PATH` fixes that. In a fresh worktree, `.generated/action-types.d.ts` does not exist until `pnpm typecheck` (or dev) writes it. Without it, every `AgentNativeActionRegistry[...]["result"]` resolves to an error type, which produces 37 phantom `'any' overrides all other types` findings. A type-aware lint step must run after typecheck.
- **Biome needs config to run cleanly.** With no config it ignores `.gitignore`. Once `.generated/` and `.react-router/` exist it lints them too (487 files, 1,171 findings). It also cannot parse Tailwind v4 directives in `app/global.css` (4 parse errors). The minimum config is `vcs.useIgnoreFile: true` plus `css.parser.tailwindDirectives: true`.
- 848 of Biome's 1,013 `noNonNullAssertion` findings are in test files. All 26 `useHookAtTopLevel` errors are vitest helpers named `use*` (`useTempGitRepos()`), not React hooks.

### Formatters

| Tool | Version | Command | Config | Wall time | Files that would change | Format diff (`git diff --shortstat`) | `pnpm test` after | `pnpm typecheck` after |
|------|---------|---------|--------|-----------|-------------------------|--------------------------------------|-------------------|------------------------|
| oxfmt | 0.72.0 | `oxfmt --check .` | committed `.oxfmtrc.json` (found automatically) | 0.29 s, 0.28 s | 303 of 502 | 303 files, +19,437 / −6,522 (214 ts, 67 tsx, 20 md, 1 json, 1 css; 25 under `.agents/` or `e2e/fixtures/`) | pass, 122 files, 3,297 tests | pass, exit 0 |
| oxfmt, pure defaults | 0.72.0 | `oxfmt -c <empty {}> --check .` | none (printWidth 100, no import sort) | not timed (see Process) | 343 of 502 | 343 files, +6,910 / −7,292 | not run | not run |
| oxfmt, repo-pinned | 0.56.0 | `node_modules/.bin/oxfmt --check .` | committed `.oxfmtrc.json` | 1.41 s (one run) | 301 of 502 | not applied | not run | not run |
| Biome format | 2.5.15 | `biome format --max-diagnostics=0 .` | none (tabs, width 80) | 0.34 s, 0.31 s (3.83 s and 3.76 s when printing every diff as JSON) | 427 of 459, plus 4 CSS parse errors | 426 files, +109,120 / −96,224 | pass, 122 files, 3,297 tests | pass, exit 0 |
| Biome format, spaces | 2.5.15 | `biome format --indent-style=space --write .` | `--indent-style=space` only | not timed | not counted | 274 files, +18,925 / −6,029 | not run | not run |

Each formatter wrote its changes onto the worktree. The diff was saved, test and typecheck ran where the table says so, and `git checkout -- grill-room/` then restored the tree. No formatter created a new file.

### How far the defaults are from the current style

Quotes, semicolons and trailing commas already match all three tools: the code uses double quotes, semicolons and trailing commas everywhere. In the oxfmt diff only 5 added lines are quote-only changes, 3 add a semicolon and 3 add a comma. Almost all of the difference is **line width** for oxfmt and **indentation** for Biome. In the 80-column oxfmt diff, 6,397 of 19,437 added lines are an existing line re-indented inside a new wrap.

oxfmt with the committed config (width 80) wraps lines the code wrote at about 90 columns:

```diff
-    return refuse("folder-not-found", `The project root does not exist: ${resolved}`);
+    return refuse(
+      "folder-not-found",
+      `The project root does not exist: ${resolved}`,
+    );
```

oxfmt defaults (width 100) join lines the code wrapped at 80, so the code is inconsistent with both widths:

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

## Classified sample

32 findings, spread over every rule that fired in oxlint and the 15 largest Biome rules. Each was read in place. "Real bug" means the code does the wrong thing today. None qualified.

| # | Tool, rule | Location | Class | Why |
|---|-----------|----------|-------|-----|
| 1 | oxlint no-unsafe-finally (Biome noUnsafeFinally too) | `server/e2e-warm-up.ts:335` | noise | The throw in `finally` is guarded by `if (!failure)`. It surfaces a cleanup failure only when the warm-up itself succeeded, as the comment says. |
| 2 | oxlint no-useless-escape (Biome noUselessEscapeInString) | `server/handoff.ts:1123` | style | `` \` `` inside a double-quoted string within a template expression; the output is identical. |
| 3 | oxlint no-unused-vars | `app/components/workspace/round-nudge.tsx:12` | noise | `ROUND_NUDGE_THRESHOLD` is imported for the JSDoc `{@link}` at line 41. |
| 4 | oxlint no-unused-vars | `actions/set-adr-worthy.test.ts:300` | noise | Destructure-to-omit (`({ adrWorthy, consequences, ...rest }) => rest`); the default lacks `ignoreRestSiblings`. 5 of the 8 findings are this. |
| 5 | oxlint no-unused-vars (Biome noUnusedImports) | `actions/remove-rule-waiver.test.ts:16` | style | Dead `previewExport` import in a test. |
| 6 | oxlint no-unused-vars (Biome noUnusedVariables) | `actions/export-session.test.ts:768` | style | Leftover `bundleDir`; the assertions compare against `result.written` directly, so nothing is missing. |
| 7 | oxlint no-useless-spread | `server/decisions-file.test.ts:179` | style | `...{ introducedBy, repo }` spread of an object literal in a fixture. |
| 8 | oxlint require-array-sort-compare | `actions/export-session.test.ts:1908` | style, latent | `groundedBriefs.sort()` on numbers sorts as strings; right for `[1, 2]`, wrong from 10 up. Test-only. |
| 9 | oxlint require-array-sort-compare | `actions/register-project.test.ts:183` | noise | Sorts `[id, folder]` pairs only to compare them regardless of order; string order is deterministic. |
| 10 | oxlint no-floating-promises | `app/components/output/consistency-section.tsx:412` | noise | React Router's `navigate()` in an `onSuccess`; there is nothing to await. |
| 11 | oxlint unbound-method | `app/components/output/build-records-section.tsx:17` | noise | `useFormatters()` returns closures over `locale`; `formatNumber` never reads `this`. |
| 12 | oxlint unbound-method | `actions/break-into-tickets.test.ts:1916` | noise | `fake.breakIntoTickets` is an arrow-function property (`server/interviewer/fake.ts:593`). |
| 13 | oxlint no-base-to-string | `app/components/workspace/brief-strip.test.tsx:37` | noise | Test-only `realT` helper; every caller passes strings or numbers. |
| 14 | oxlint no-redundant-type-constituents | `server/interviewer/prompt.ts:215` | style | `unknown \| null` is just `unknown`. |
| 15 | oxlint no-redundant-type-constituents | `e2e/fixtures/demo-project/grill-room/server/export-bundle.ts:148` | noise | A fixture copy whose imports do not resolve; it should be ignored, not linted. 6 of the 9 are fixture files. |
| 16 | oxlint no-redundant-type-constituents, cold tree | `app/components/output/export-section.tsx:104` | noise | Only appears before `.generated/` exists (see Notes); 37 such findings vanish after typecheck. |
| 17 | Biome useHookAtTopLevel (error) | `actions/assess-readiness.test.ts:20` | noise | `useTempGitRepos()` is a vitest helper, not a React hook. All 26 are this. |
| 18 | Biome noNonNullAssertion | `actions/break-into-tickets.ts:189` | style | `session!.id` after a lookup the action already guarded; 848 of 1,013 are in tests. |
| 19 | Biome useExhaustiveDependencies | `app/components/sessions/create-session-dialog.tsx:131` | noise | A deliberate open-only effect, already marked `eslint-disable-next-line react-hooks/exhaustive-deps`. |
| 20 | Biome useExhaustiveDependencies | `app/components/output/build-record-form.tsx:126` | noise | Keyed on `record?.updatedAt` by design: it re-syncs when the stored record changes (comment above it). |
| 21 | Biome useIterableCallbackReturn | `app/components/workspace/markdown.tsx:19` | noise | A `switch` over a closed `InlineNode` union where every case returns; TypeScript proves it exhaustive. |
| 22 | Biome useIterableCallbackReturn | `app/components/output/tickets-section.tsx:118` | style | `forEach((n) => map.set(...))` returns the Map, which is ignored. |
| 23 | Biome noArrayIndexKey | `app/components/workspace/markdown.tsx:22` | noise | Parsed markdown nodes, rendered from scratch for each text and never reordered. |
| 24 | Biome noAssignInExpressions | `server/export-bundle.ts:1008` | style | The `(history[id] ??= []).push(...)` idiom. |
| 25 | Biome noPrototypeBuiltins | `server/interviewer/fake.ts:279` | style | `Object.prototype.hasOwnProperty.call(...)` is already the safe form; Biome prefers `Object.hasOwn`. |
| 26 | Biome noImplicitAnyLet | `server/projects.ts:157` | noise | `let stats;` assigned in a `try`; TypeScript's control flow types it, and typecheck passes. |
| 27 | Biome noDangerouslySetInnerHtml | `app/root.tsx:69` | noise | An inline constant theme-init script, with no user input. |
| 28 | Biome useAriaPropsSupportedByRole | `app/components/workspace/brief-strip.tsx:227` | style (a11y) | `aria-label` on a span with no role is ignored by screen readers; the full summary text is still in the DOM, since truncation is CSS only. |
| 29 | Biome noLabelWithoutControl | `app/components/output/export-file-list.tsx:66` | noise | The label wraps a Radix `Checkbox`, which renders a `button`, a labelable element. |
| 30 | Biome parse | `app/global.css:15` | noise | Tailwind v4 directives; needs `css.parser.tailwindDirectives`. |
| 31 | Biome noShadowRestrictedNames | `server/interviewer/claude-cli.test.ts:87` | style | A test helper named `valueOf`. |
| 32 | Biome noExplicitAny | `vite.config.ts:7` | style | The scaffold's cast of the plugin factories. |

**Real bugs: 0.** No test coverage question arises. The closest is #8, a lexicographic numeric sort in a test that is correct for the data it sorts.

## Testing the "zero of the delegation failures" claim

`docs/spikes/roundup-harvest.md` says a lint pass would have caught none of the roughly 35 logged failures. The log now has 211 rows, 80 of them with a first attempt that did not pass (extracted to `delegation-failures.txt` in the evidence). Every one was read against the rule sets above. They are:
- review-found logic holes (retry revival, deadline order, stale flags, `check-ignore` path forms);
- tests that survive a revert;
- prompt and spec contradictions;
- migrations;
- seams between tickets;
- process failures: a background verify, a classifier block, a missing executable bit, a stray `pnpm-workspace.yaml` edit.

None is a pattern oxlint or Biome flags with any rule shown here.

One is lint-adjacent. In gr-c0t.26 (PR #137), "a slot helper erased the proposal types to `unknown`". That code is fixed, so it cannot be re-run. No default rule flags widening a type to `unknown`. `no-redundant-type-constituents` only fires on a union such as `unknown | X`, which is a different pattern. The claim holds at **0 of 80**, with one near miss. The 16 `pr-nits` beads (`bd list --label pr-nits --all`) contain no unused-import, dead-code or formatting nit either.

What the linters do find that reviewers did not: 2 dead imports, 1 dead variable, 2 useless escapes and spreads. None of them changes behaviour.

## Vite+

`vite-plus` is at 1.1.0 on npm (`latest`; it is no longer a beta), MIT. `vp --version` reports vite 8.3.3, rolldown 1.2.12, vitest 5.0.3 and oxfmt 0.72.0, and the package pins `oxlint` 1.87.0 and `oxlint-tsgolint` 7.0.2003. These are the same binaries measured above, with the same output: `vp lint .` in `grill-room/` printed the same 13 findings.

**`vp lint` can sit beside agent-native.** It works from a temp install with no project change. It forwards to oxlint and adds nothing over calling oxlint directly.

**`vp fmt` cannot without wiring.** Run against `grill-room/`, it handed off to the project's own oxfmt 0.56.0. That oxfmt then tried to load `vite.config.ts` as its config and failed: `Cannot find package 'vite-plus' imported from .../oxfmt@0.56.0/.../cli.js`. Vite+ wants the `fmt` and `lint` blocks inside `vite.config.ts`, using `defineConfig` from `vite-plus`, and its docs advise against `.oxfmtrc.json`. That file is agent-native's: it imports `agentNative` from `@agent-native/core/vite` and `defineConfig` from `vite`.

**A full `vp migrate` would fight agent-native.** Per `docs/guide/migrate-rules.md` in the package, it:
- points the existing `vite` dependency at `@voidzero-dev/vite-plus-core` (vite 8.3.3), where grill-room pins `vite` 8.1.0 to match `@agent-native/core` 0.182.1's template;
- moves vitest to 5.0.3, where the suite and `@stryker-mutator/vitest-runner` 10.0.0 are on vitest 4.1 (the runner's own dev dependency is 4.1.10);
- rewrites `vitest` imports to `vite-plus/test*`;
- adds `vite@*` and `vitest@*` overrides to `pnpm-workspace.yaml`;
- regenerates the lockfile.

agent-native's CLI resolves the project's `vite` binary for `dev` (`findViteBin()` in `dist/cli/index.js`), runs `react-router typegen` and then `tsc --noEmit` for `typecheck`, and goes through `react-router build` for `build`. All three would then run on a Vite that agent-native did not ship with, and the next agent-native upgrade would contend with the overrides.

Vite+ brings nothing here that oxlint and oxfmt do not already bring on their own, and it costs a toolchain migration.

## Recommendation

**Adopt nothing yet.** The evidence:
- 0 real bugs among 13 plain oxlint, 34 type-aware oxlint and 1,159 Biome findings;
- 0 of 80 delegation failures, and 0 of 16 nits beads, that a lint rule would have caught;
- formatting is safe (3,297 tests and typecheck green on both formatted trees), but its value is unevidenced, and its one-time cost is a 303-file commit at the committed width, or 343 files at width 100.

**Rule set.** The smallest set that catches the real bugs found is empty. If a linter is adopted anyway as cheap hygiene, the smallest useful start is oxlint's default `correctness` category with `no-unused-vars` set to `ignoreRestSiblings: true`, plus `ignorePatterns` for `e2e/fixtures/**` and `.agents/**`. That leaves 8 findings to fix once, all style. Leave out the type-aware rules: they add 21 findings, none real, and they need typecheck to run first.

**What would change the verdict.** A logged delegation failure, or a reviewer finding, that a named rule would have caught. A real bug of the `no-floating-promises` or `require-array-sort-compare` kind in production code is the most likely candidate. Or the owner deciding that diff noise from inconsistent wrapping is costing review attention.

**Adoption cost, if a trigger fires**, assuming oxfmt and oxlint:

| Item | Cost |
|------|------|
| oxfmt dependency | none: 0.56.0 is installed (bumping to 0.72.0 changes 2 more files) |
| oxfmt config | `.oxfmtrc.json` exists. Choose `printWidth` 80 (as committed) or 100. Add an ignore for `.agents/` (vendored framework skills, 16 files would change), `e2e/fixtures/`, `CHANGELOG.md` and `changelog/`: about 5 lines |
| oxlint dependency | one devDependency (`oxlint` 1.87.0); `oxlint-tsgolint` only if type-aware |
| oxlint config | `.oxlintrc.json`, about 10 lines (ignore patterns, one rule option) |
| Scripts | `"fmt": "oxfmt ."`, `"fmt:check": "oxfmt --check ."`, `"lint": "oxlint ."` in `package.json`; a `lint` recipe in `justfile`, joined to `check: typecheck test e2e` |
| Where it runs | not inside `pnpm test` (vitest stays focused, and Stryker reuses it); as a third verify command in the builder template, after `pnpm typecheck`. Cost per run: 0.3 s each |
| One-time format commit | 303 files, +19,437 / −6,522 at width 80; plus a `.git-blame-ignore-revs` line |
| Conflicts | `gh pr list --repo jisequilla/grill-room --state open` returns none right now. But the commit touches 60% of files, so any worktree branch in flight when it lands will conflict. Land it between waves, with no tickets running |

Biome is the worse fit. It needs a config just to run cleanly, and its defaults re-indent 426 files with tabs. Its largest rules (`noNonNullAssertion`, `useHookAtTopLevel`) are noise in this codebase. It also competes with oxfmt, the formatter agent-native already picked.

## Process

- No `grill-room/package.json`, `pnpm-lock.yaml` or `pnpm-workspace.yaml` change. `node_modules` was installed with `pnpm install --frozen-lockfile` (pnpm 10.29.1, as the project pins). The tools were installed with npm into the session scratchpad.
- The worktree-isolation guard refused several compound commands (loops, `/usr/bin/time`, a wrapper script given a long argument list), each before running anything. Each was re-run as the separate plain command the refusal asked for. The one cost is that the pure-defaults oxfmt check was not timed.

## Reproduce

Raw output is in the main checkout's `.scratch/evidence/gr-rn6/` (not committed): every tool's JSON or text output, the three format diffs, the test and typecheck logs, the `vp` probes, and `delegation-failures.txt`.

```bash
# tools, outside the repo
T=$(mktemp -d) && (cd "$T" && echo '{"private":true}' > package.json \
  && npm install oxlint@1.87.0 oxlint-tsgolint@7.0.2004 oxfmt@0.72.0 @biomejs/biome@2.5.15 vite-plus@1.1.0)
B="$T/node_modules/.bin"
cd grill-room
pnpm install --frozen-lockfile

# linters (run each twice for timing)
"$B/oxlint" --format=json . > oxlint.json
OXLINT_TSGOLINT_PATH="$B/tsgolint" "$B/oxlint" --type-aware --format=json . > oxlint-ta-cold.json   # before .generated/ exists
pnpm typecheck
OXLINT_TSGOLINT_PATH="$B/tsgolint" "$B/oxlint" --type-aware --format=json . > oxlint-ta.json
"$B/biome" lint --reporter=json --max-diagnostics=none . > biome-lint.json   # on a tree without .generated/ for the 467-file count
python3 -c "import json,collections,sys; d=json.load(open(sys.argv[1])); c=collections.Counter(x['code'] for x in d['diagnostics']); print(len(d['diagnostics']), c.most_common(15))" oxlint-ta.json
python3 -c "import json,collections,sys; d=json.load(open(sys.argv[1])); c=collections.Counter(x['category'] for x in d['diagnostics']); print(len(d['diagnostics']), c.most_common(15))" biome-lint.json

# formatter checks
"$B/oxfmt" --check .                                   # committed .oxfmtrc.json
echo '{}' > "$T/empty.json" && "$B/oxfmt" -c "$T/empty.json" --check .   # pure defaults
node_modules/.bin/oxfmt --check .                      # repo-pinned 0.56.0
"$B/biome" format --max-diagnostics=0 .

# format diffs: apply, measure, verify, restore (repeat per formatter)
"$B/oxfmt" --write .      # or: "$B/oxfmt" -c "$T/empty.json" --write . | "$B/biome" format --write . | "$B/biome" format --indent-style=space --write .
git diff --shortstat
pnpm test && pnpm typecheck
git checkout -- .

# line widths
git ls-files | grep -E '\.(ts|tsx)$' | xargs awk '{l=length($0); t++; if(l>80)a++; if(l>100)b++; if(l>120)c++} END{print t,a,b,c}'

# Vite+
"$B/vp" --version
"$B/vp" lint .
"$B/vp" fmt --check .     # fails: Cannot find package 'vite-plus' imported from oxfmt@0.56.0

# open PRs
gh pr list --repo jisequilla/grill-room --state open
```
