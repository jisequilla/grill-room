import type { APIRequestContext, FullConfig, Page } from "@playwright/test";
import { chromium, request } from "@playwright/test";

/**
 * How long one warm-up step may wait for its first response. Taken from
 * `webServer.timeout` in `playwright.config.ts`: the server gets that long to
 * start, and a route that compiles on demand gets that long again to answer.
 */
const WARM_UP_LIMIT_MS = 180_000;

/**
 * The dev server answers a page navigation with 503 and a self-polling
 * "Dev server is restarting…" page while its Nitro worker is still starting
 * (`@agent-native/core`'s `nitroStartupGate`). That answer comes from the gate,
 * not the route, so it does not count as warm: the step navigates again.
 */
const STARTING_STATUS = 503;
const STARTING_RETRY_DELAY_MS = 500;

class WarmUpError extends Error {
  constructor(url: string, elapsedMs: number, cause: string) {
    super(
      `e2e warm-up failed: ${url} gave no response after ${elapsedMs} ms (limit ${WARM_UP_LIMIT_MS} ms): ${cause}`,
    );
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message.split("\n")[0]! : String(error);
}

/**
 * Times one step and prints its line. `answer` returns the HTTP status; any
 * status counts as warm — a 4xx refusal still means the route compiled. No
 * response at all (connection error, or the step's own limit running out)
 * stops the suite with the URL and the elapsed time.
 */
async function warm(path: string, answer: (deadline: number) => Promise<number>): Promise<void> {
  const startedAt = Date.now();
  let status: number;
  try {
    status = await answer(startedAt + WARM_UP_LIMIT_MS);
  } catch (error) {
    throw new WarmUpError(path, Date.now() - startedAt, describe(error));
  }
  console.log(`e2e warm-up: ${path} ${status} ${Date.now() - startedAt} ms`);
}

/** Navigates like a user would, so the client bundle compiles, not just the server route. */
function navigate(page: Page, path: string) {
  return async (deadline: number): Promise<number> => {
    for (;;) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) throw new Error("the dev server was still starting");
      const response = await page.goto(path, { timeout: remaining });
      if (!response) throw new Error("navigation produced no response");
      if (response.status() !== STARTING_STATUS) return response.status();
      await page.waitForTimeout(STARTING_RETRY_DELAY_MS);
    }
  };
}

async function createThrowawaySession(api: APIRequestContext): Promise<string> {
  const response = await api.post("/_agent-native/actions/create-session", {
    data: {
      title: "e2e warm-up",
      idea: "Throwaway session that warms the session page before the specs run; deleted at once.",
    },
    timeout: WARM_UP_LIMIT_MS,
  });
  if (!response.ok()) {
    throw new Error(
      `e2e warm-up could not create its session: ${response.status()} ${await response.text()}`,
    );
  }
  const { id } = (await response.json()) as { id: string };
  return id;
}

async function deleteSession(api: APIRequestContext, id: string): Promise<void> {
  const response = await api.post("/_agent-native/actions/delete-session", {
    data: { id },
  });
  if (!response.ok()) {
    throw new Error(
      `e2e warm-up could not delete its session ${id}: ${response.status()} ${await response.text()}`,
    );
  }
}

/**
 * Pays the dev server's cold compile before any spec runs. `just e2e` starts
 * a fresh server every run, and the first page load and the first action call
 * compile on demand; left alone, that cost lands inside whichever spec runs
 * first and can eat its own waits. Warms, in order: `/`, a session page, and
 * the `preview-export` action.
 */
export default async function globalSetup(config: FullConfig): Promise<void> {
  const baseURL = config.projects[0]?.use.baseURL;
  if (!baseURL) {
    throw new Error("e2e warm-up needs use.baseURL from playwright.config.ts");
  }

  const api = await request.newContext({ baseURL });
  const browser = await chromium.launch();
  let sessionId: string | undefined;
  let failure: unknown;
  try {
    const page = await browser.newPage({ baseURL });

    await warm("/", navigate(page, "/"));

    sessionId = await createThrowawaySession(api);
    const sessionPath = `/sessions/${sessionId}`;
    await warm(sessionPath, navigate(page, sessionPath));

    // The session has no project on purpose: `preview-export` refuses it with
    // 409 `no-project`, and that refusal has still compiled the route.
    const previewPath = `/_agent-native/actions/preview-export?sessionId=${encodeURIComponent(sessionId)}`;
    await warm(previewPath, async (deadline) => {
      const response = await api.get(previewPath, {
        timeout: Math.max(deadline - Date.now(), 1),
      });
      return response.status();
    });
  } catch (error) {
    failure = error;
    throw error;
  } finally {
    await browser.close();
    try {
      if (sessionId) await deleteSession(api, sessionId);
    } catch (error) {
      // Never hide the warm-up's own failure behind a cleanup failure.
      if (!failure) throw error;
      console.error(describe(error));
    } finally {
      await api.dispose();
    }
  }
}
