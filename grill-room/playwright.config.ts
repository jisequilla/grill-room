import { randomUUID } from "node:crypto";
import os from "node:os";
import path from "node:path";

import { defineConfig, devices } from "@playwright/test";

import { INTERVIEWER_ENV_VAR } from "./server/interviewer/index.js";

/**
 * A dedicated port, away from `pnpm dev`'s default, so the smoke test can run
 * alongside a developer's normal dev server without a collision.
 */
const PORT = 5240;

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
  // The fake interviewer's turn queue lives once per server process (see
  // `server/interviewer/fake.ts` and `cannedInterviewTurns()`): two specs, or
  // two workers sharing the one `webServer` below, would drain each other's
  // queued turns. One test, one worker, no retries — a retry would replay the
  // same UI actions against an already-drained queue.
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
