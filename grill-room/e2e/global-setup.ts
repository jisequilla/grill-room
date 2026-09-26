import type { FullConfig } from "@playwright/test";
import { chromium, request } from "@playwright/test";

import { describe, runWarmUp } from "../server/e2e-warm-up.js";

/**
 * Pays the dev server's cold compile before any spec runs. `just e2e` starts
 * a fresh server every run, and the first page load and the first action call
 * compile on demand; left alone, that cost lands inside whichever spec runs
 * first and can eat its own waits. Warms, in order: `/`, a session page, and
 * the `preview-export` action, retrying a connection that drops while the
 * server is still starting — see `server/e2e-warm-up.ts` for that sequence
 * and its retry behaviour. This file is a thin Playwright adapter over it:
 * Playwright's own `page.goto`, `api.post`, `api.get`, `console.log` and
 * `console.error`.
 */
export default async function globalSetup(config: FullConfig): Promise<void> {
  const baseURL = config.projects[0]?.use.baseURL;
  if (!baseURL) {
    throw new Error("e2e warm-up needs use.baseURL from playwright.config.ts");
  }

  const api = await request.newContext({ baseURL });
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ baseURL });
    await runWarmUp({
      goto: (path, opts) => page.goto(path, opts),
      post: (path, opts) => api.post(path, opts),
      get: (path, opts) => api.get(path, opts),
      log: (message) => console.log(message),
      logError: (message) => console.error(message),
    });
  } finally {
    // A throwing close must never stop the session (already deleted inside
    // `runWarmUp`, above) from having been deleted, and must never stop
    // `api.dispose()` from running below it.
    try {
      await browser.close();
    } catch (error) {
      console.error(describe(error));
    }
    await api.dispose();
  }
}
