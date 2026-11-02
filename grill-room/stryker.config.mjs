import path from "node:path";

// Tests that compare against files outside the app (the upstream skills, the
// review-loop workflow) find the repository as the app's parent directory.
// The sandbox copy at .stryker-tmp/sandbox-* has a different parent, so name
// the repository here; Stryker's workers and vitest's inherit the variable.
// See test/repo-root.ts.
process.env.GRILL_ROOM_REPO_ROOT ??= path.resolve(import.meta.dirname, "..");

/** @type {import("@stryker-mutator/api/core").PartialStrykerOptions} */
export default {
  // pnpm does not hoist the runner next to core, so Stryker's default
  // "@stryker-mutator/*" glob finds no plugin.
  plugins: ["@stryker-mutator/vitest-runner"],
  testRunner: "vitest",
  coverageAnalysis: "perTest",
  ignoreStatic: true,
  concurrency: 2,
  // Matches vitest's 30 s hookTimeout, which a loaded machine has needed.
  timeoutMS: 30_000,
  // The whole mutation run budget (RUN_BUDGET_MS in scripts/mutate-diff.ts,
  // 570000 ms, rounded up to minutes). A slower dry run ends as an overrun
  // at the budget instead of failing as runner-failed at Stryker's default
  // 5 minutes. scripts/stryker-config.test.ts keeps the two in step.
  dryRunTimeoutMinutes: 10,
  // Stryker's tsconfig rewrite needs the TypeScript 5 API and the installed
  // compiler is 7. Pointing it at a file the sandbox never holds skips the
  // rewrite; this project's tsconfig extends a package, so none is needed.
  tsconfigFile: "no-tsconfig-rewrite.json",
  // Agent skill folders hold symlinks Stryker cannot copy and no test reads.
  ignorePatterns: [".claude", ".agents", ".scratch"],
  reporters: ["json", "clear-text"],
  jsonReporter: { fileName: ".scratch/mutation/stryker-report.json" },
};
