/**
 * The e2e warm-up sequence (`e2e/global-setup.ts`) and the retry it needs
 * around a connection that drops while the dev server is still starting.
 * Kept out of `e2e/**` so vitest can unit-test it directly: that directory is
 * excluded from the vitest suite (`vitest.config.ts`), which runs against a
 * real running server through a different runner (`pnpm test:e2e`).
 */

/**
 * How long one warm-up step may wait for its first response. Taken from
 * `webServer.timeout` in `playwright.config.ts`: the server gets that long to
 * start, and a route that compiles on demand gets that long again to answer.
 */
export const WARM_UP_LIMIT_MS = 180_000;

/**
 * The dev server answers a page navigation with 503 and a self-polling
 * "Dev server is restarting…" page while its Nitro worker is still starting
 * (`@agent-native/core`'s `nitroStartupGate`). That answer comes from the gate,
 * not the route, so it does not count as warm: the step navigates again.
 */
export const STARTING_STATUS = 503;
const STARTING_RETRY_DELAY_MS = 500;

/**
 * A connection can be reset or refused before the startup gate is even
 * listening. Recognised by message, the same way `describe()` reduces any
 * error to one line.
 */
const TRANSIENT_ERROR_PATTERNS = [
  "ECONNRESET",
  "ECONNREFUSED",
  "EPIPE",
  "socket hang up",
  "ERR_CONNECTION_RESET",
  "ERR_CONNECTION_REFUSED",
];
const CONNECTION_RETRY_DELAY_MS = 500;

const NOOP_RETRY = (): void => {};

export function describe(error: unknown): string {
  return error instanceof Error ? error.message.split("\n")[0]! : String(error);
}

function isTransientConnectionError(error: unknown): boolean {
  const message = describe(error);
  return TRANSIENT_ERROR_PATTERNS.some((pattern) => message.includes(pattern));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * A step failed for a reason more specific than "gave no response": the
 * startup gate never lifted, or a dropped connection never recovered before
 * the deadline. `warm()` reads `reason` to build its message instead of the
 * generic wording.
 */
export class WarmUpStepFailure extends Error {
  readonly reason: string;

  constructor(reason: string, cause: string) {
    super(cause);
    this.reason = reason;
  }
}

export class WarmUpError extends Error {
  constructor(url: string, elapsedMs: number, reason: string, cause: string) {
    super(
      `e2e warm-up failed: ${url} ${reason} after ${elapsedMs} ms (limit ${WARM_UP_LIMIT_MS} ms): ${cause}`,
    );
  }
}

/**
 * Retries `attempt` while it fails with a transient connection error, waiting
 * `CONNECTION_RETRY_DELAY_MS` between tries, until `deadline` (an absolute
 * `Date.now()` value) passes. A non-transient error is never retried. Calling
 * `attempt` again re-runs it from its own start — for a step with an inner
 * loop (the 503 poll in `navigateStep`), that means the loop's first request,
 * not wherever it was interrupted.
 */
export async function retryTransient<T>(
  attempt: () => Promise<T>,
  deadline: number,
  onRetry: (retryCount: number) => void,
): Promise<T> {
  let retries = 0;
  for (;;) {
    try {
      return await attempt();
    } catch (error) {
      if (!isTransientConnectionError(error)) throw error;
      if (Date.now() >= deadline) {
        throw new WarmUpStepFailure("the server kept dropping the connection", describe(error));
      }
      retries += 1;
      onRetry(retries);
      await sleep(CONNECTION_RETRY_DELAY_MS);
    }
  }
}

export interface WarmUpResponse {
  status(): number;
}

export interface WarmUpApiResponse extends WarmUpResponse {
  ok(): boolean;
  text(): Promise<string>;
  json(): Promise<unknown>;
}

export interface WarmUpDeps {
  goto: (path: string, opts: { timeout: number }) => Promise<WarmUpResponse | null>;
  post: (
    path: string,
    opts: { data?: unknown; timeout?: number },
  ) => Promise<WarmUpApiResponse>;
  get: (path: string, opts: { timeout: number }) => Promise<WarmUpResponse>;
  log: (message: string) => void;
}

/**
 * Times one step, retrying a transient connection error through
 * `retryTransient`, and prints its line. `answer` returns the HTTP status;
 * any status counts as warm — a 4xx refusal still means the route compiled.
 * No response at all (a non-transient error, or the step's own limit running
 * out) stops the suite with the URL and the elapsed time.
 */
export async function warm(
  path: string,
  answer: (deadline: number) => Promise<number>,
  log: (message: string) => void,
): Promise<void> {
  const startedAt = Date.now();
  const deadline = startedAt + WARM_UP_LIMIT_MS;
  let retries = 0;
  let status: number;
  try {
    status = await retryTransient(
      () => answer(deadline),
      deadline,
      (count) => {
        retries = count;
      },
    );
  } catch (error) {
    const reason = error instanceof WarmUpStepFailure ? error.reason : "gave no response";
    const cause = error instanceof WarmUpStepFailure ? error.message : describe(error);
    throw new WarmUpError(path, Date.now() - startedAt, reason, cause);
  }
  const suffix =
    retries === 0 ? "" : ` (${retries} connection retr${retries === 1 ? "y" : "ies"})`;
  log(`e2e warm-up: ${path} ${status} ${Date.now() - startedAt} ms${suffix}`);
}

/** Navigates like a user would, so the client bundle compiles, not just the server route. */
export function navigateStep(
  goto: WarmUpDeps["goto"],
  path: string,
): (deadline: number) => Promise<number> {
  return async (deadline: number): Promise<number> => {
    for (;;) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) {
        throw new WarmUpStepFailure(
          "the dev server was still starting (503)",
          `status ${STARTING_STATUS} persisted`,
        );
      }
      const response = await goto(path, { timeout: remaining });
      if (!response) throw new Error("navigation produced no response");
      if (response.status() !== STARTING_STATUS) return response.status();
      await sleep(STARTING_RETRY_DELAY_MS);
    }
  };
}

const CREATE_SESSION_PATH = "/_agent-native/actions/create-session";
const DELETE_SESSION_PATH = "/_agent-native/actions/delete-session";

async function createThrowawaySession(post: WarmUpDeps["post"]): Promise<string> {
  const response = await post(CREATE_SESSION_PATH, {
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

async function deleteSession(post: WarmUpDeps["post"], id: string): Promise<void> {
  const response = await post(DELETE_SESSION_PATH, {
    data: { id },
  });
  if (!response.ok()) {
    throw new Error(
      `e2e warm-up could not delete its session ${id}: ${response.status()} ${await response.text()}`,
    );
  }
}

/**
 * Pays the dev server's cold compile before any spec runs, retrying a
 * connection that drops while the server is still starting. Warms, in
 * order: `/`, the `create-session` action (silent: it prints no warm-up
 * line of its own, and never has), a session page, and the `preview-export`
 * action — then always deletes the throwaway session in cleanup, itself
 * retried the same way with its own deadline, and printing no line either.
 * A cleanup failure never hides the warm-up's own failure: it is reported
 * only when nothing else already failed.
 */
export async function runWarmUp(deps: WarmUpDeps): Promise<void> {
  const { goto, post, get, log } = deps;
  let sessionId: string | undefined;
  let failure: unknown;

  try {
    await warm("/", navigateStep(goto, "/"), log);

    sessionId = await retryTransient(
      () => createThrowawaySession(post),
      Date.now() + WARM_UP_LIMIT_MS,
      NOOP_RETRY,
    );

    const sessionPath = `/sessions/${sessionId}`;
    await warm(sessionPath, navigateStep(goto, sessionPath), log);

    // The session has no project on purpose: `preview-export` refuses it with
    // 409 `no-project`, and that refusal has still compiled the route.
    const previewPath = `/_agent-native/actions/preview-export?sessionId=${encodeURIComponent(sessionId)}`;
    await warm(
      previewPath,
      async (deadline) => {
        const response = await get(previewPath, {
          timeout: Math.max(deadline - Date.now(), 1),
        });
        return response.status();
      },
      log,
    );
  } catch (error) {
    failure = error;
    throw error;
  } finally {
    if (sessionId) {
      const id = sessionId;
      try {
        await retryTransient(
          () => deleteSession(post, id),
          Date.now() + WARM_UP_LIMIT_MS,
          NOOP_RETRY,
        );
      } catch (error) {
        // Never hide the warm-up's own failure behind a cleanup failure.
        if (!failure) throw error;
        log(describe(error));
      }
    }
  }
}
