import { randomUUID } from "node:crypto";
import os from "node:os";
import path from "node:path";

import { defineConfig, devices } from "@playwright/test";

import { INTERVIEWER_ENV_VAR } from "./server/interviewer/index.js";

/**
 * A dedicated port, away from `pnpm dev`'s default, so the smoke test can run
 * alongside a developer's normal dev server without a collision.
 *
 * Overridable via `E2E_PORT` so two worktrees can run `just e2e`
 * concurrently without colliding with each other: the `e2e` recipe in the
 * repo-root `justfile` picks a free port and exports `E2E_PORT` before
 * calling `pnpm test:e2e` when the caller hasn't already set one.
 */
const PORT = Number(process.env.E2E_PORT) || 5240;

/**
 * A fresh directory per run, outside the repo entirely, so the suite can never
 * read or write the developer's `data/pglite`. PGlite creates the directory
 * itself on first use (see `@agent-native/core`'s `preparePgliteDataDir`), so
 * nothing here needs to `mkdir` it first.
 */
const DATABASE_DIR = path.join(os.tmpdir(), `grill-room-e2e-${randomUUID()}`);

/**
 * The env the app server runs under for the whole suite. `GRILL_ROOM_INTERVIEWER`
 * is the one thing standing between this test and the real Claude CLI (see
 * `server/interviewer/index.ts`), so it is asserted below rather than trusted.
 */
const WEB_SERVER_ENV = {
  [INTERVIEWER_ENV_VAR]: "fake",
  AUTH_DISABLED: "true",
  DATABASE_URL: `pglite:${DATABASE_DIR}`,
} as const;

if (WEB_SERVER_ENV[INTERVIEWER_ENV_VAR] !== "fake") {
  throw new Error(
    `playwright.config.ts must start the app with ${INTERVIEWER_ENV_VAR}=fake. The browser smoke test must never reach the real Claude CLI.`,
  );
}

export default defineConfig({
  testDir: "./e2e",
  timeout: 120_000,
  expect: { timeout: 15_000 },
  // The fake interviewer keeps one scripted turn queue per session
  // (`server/interviewer/fake.ts`'s `createScenarioInterviewer`), built from
  // a named scenario chosen for it (`actions/use-fake-scenario.ts`) before
  // its first request. That is what lets more than one spec file run
  // against this one `webServer`: each test creates its own session and
  // chooses its own scenario, so one test's requests can never drain
  // another's queue. Workers still default to one — nothing here has proven
  // a need for more — and retries stay off, since a retry would replay the
  // same UI actions against a session whose queue the first attempt may
  // already have consumed partway through.
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["html", { open: "never" }]],
  outputDir: "e2e/artifacts",
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command: `pnpm exec agent-native dev --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    // Never reuse a developer's own `pnpm dev`: that process was not started
    // with the fake interviewer or an isolated database, and its queue may
    // already be drained by other work.
    reuseExistingServer: false,
    // The dev server itself binds the port in a few seconds, but the first
    // real page request compiles the route on demand — measured close to 20 s
    // cold. This timeout covers the bind; `timeout` above covers the test.
    timeout: 180_000,
    env: WEB_SERVER_ENV,
  },
});
