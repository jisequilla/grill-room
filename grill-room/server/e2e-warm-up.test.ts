import { describe, expect, it, vi } from "vitest";

import {
  CONNECTION_RETRY_DELAY_MS,
  navigateStep,
  retryTransient,
  runWarmUp,
  STARTING_RETRY_DELAY_MS,
  STARTING_STATUS,
  WARM_UP_LIMIT_MS,
  warm,
  WarmUpError,
  WarmUpStepFailure,
} from "./e2e-warm-up.js";

const CREATE_SESSION_PATH = "/_agent-native/actions/create-session";
const DELETE_SESSION_PATH = "/_agent-native/actions/delete-session";
const SESSION_PATH = "/sessions/session-1";

describe("retryTransient", () => {
  it("retries a transient connection error and succeeds, reporting the retry count", async () => {
    let calls = 0;
    const attempt = async () => {
      calls += 1;
      if (calls <= 2) throw new Error("read ECONNRESET");
      return "ok";
    };
    const retries: number[] = [];

    const result = await retryTransient(attempt, Date.now() + 10_000, (n) => retries.push(n));

    expect(result).toBe("ok");
    expect(calls).toBe(3);
    expect(retries).toEqual([1, 2]);
  });

  it("does not retry a non-transient error", async () => {
    let calls = 0;
    const boom = new Error("boom");
    const attempt = async () => {
      calls += 1;
      throw boom;
    };

    await expect(retryTransient(attempt, Date.now() + 10_000, () => {})).rejects.toBe(boom);
    expect(calls).toBe(1);
  });

  it("stops retrying at the deadline with the 'kept dropping the connection' message", async () => {
    const attempt = async () => {
      throw new Error("read ECONNRESET");
    };
    const deadline = Date.now() + 10;

    let caught: unknown;
    try {
      await retryTransient(attempt, deadline, () => {});
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(WarmUpStepFailure);
    expect((caught as WarmUpStepFailure).reason).toBe("the server kept dropping the connection");
    expect((caught as Error).message).toContain("ECONNRESET");
  });
});

describe("wording", () => {
  it("says the dev server was still starting (503) when the startup gate never lifts before the limit", async () => {
    const goto = vi.fn(async () => ({ status: () => STARTING_STATUS }));
    const step = navigateStep(goto, SESSION_PATH);

    let caught: unknown;
    try {
      await step(Date.now() + 5);
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(WarmUpStepFailure);
    expect((caught as WarmUpStepFailure).reason).toBe("the dev server was still starting (503)");
    expect(goto).toHaveBeenCalledTimes(1);
  });

  it("warm() surfaces the 503 wording instead of 'gave no response'", async () => {
    const log = vi.fn();

    let message = "";
    try {
      await warm(
        SESSION_PATH,
        async () => {
          throw new WarmUpStepFailure(
            "the dev server was still starting (503)",
            "status 503 persisted",
          );
        },
        log,
      );
    } catch (error) {
      message = (error as Error).message;
    }

    expect(message).toContain("the dev server was still starting (503)");
    expect(message).not.toContain("gave no response");
  });

  it("keeps 'gave no response' for a navigation that produced no response at all", async () => {
    const goto = vi.fn(async () => null);

    await expect(
      runWarmUp({ goto, post: vi.fn(), get: vi.fn(), log: vi.fn(), logError: vi.fn() }),
    ).rejects.toThrow(/gave no response/);
    expect(goto).toHaveBeenCalledTimes(1);
  });
});

type Site = "root" | "create-session" | "session-page" | "preview-export" | "delete-session" | "none";

function buildDeps(failingSite: Site) {
  const log = vi.fn();
  const logError = vi.fn();
  const seen = new Map<string, number>();

  function shouldFail(site: Site, path: string): boolean {
    if (failingSite !== site) return false;
    const before = seen.get(path) ?? 0;
    seen.set(path, before + 1);
    return before === 0;
  }

  const goto = vi.fn(async (path: string) => {
    const site: Site = path === "/" ? "root" : "session-page";
    if (shouldFail(site, path)) throw new Error("read ECONNRESET");
    return { status: () => 200 };
  });

  const post = vi.fn(async (path: string) => {
    if (path === CREATE_SESSION_PATH) {
      if (shouldFail("create-session", path)) throw new Error("read ECONNRESET");
      return {
        ok: () => true,
        status: () => 200,
        text: async () => "",
        json: async () => ({ id: "session-1" }),
      };
    }
    if (path === DELETE_SESSION_PATH) {
      if (shouldFail("delete-session", path)) throw new Error("read ECONNRESET");
      return { ok: () => true, status: () => 200, text: async () => "", json: async () => ({}) };
    }
    throw new Error(`unexpected post path ${path}`);
  });

  const get = vi.fn(async (path: string) => {
    if (shouldFail("preview-export", path)) throw new Error("read ECONNRESET");
    return { status: () => 409 };
  });

  return { goto, post, get, log, logError };
}

describe("runWarmUp", () => {
  it("prints exactly three warm-up lines, none retried, when nothing fails", async () => {
    const { goto, post, get, log, logError } = buildDeps("none");

    await runWarmUp({ goto, post, get, log, logError });

    expect(log).toHaveBeenCalledTimes(3);
    for (const [message] of log.mock.calls) {
      expect(message as string).not.toContain("connection retr");
    }
  });

  it("retries a dropped connection warming '/' and reports it, without changing the line count", async () => {
    const { goto, post, get, log, logError } = buildDeps("root");

    await runWarmUp({ goto, post, get, log, logError });

    expect(log).toHaveBeenCalledTimes(3);
    const line = log.mock.calls.map((c) => c[0] as string).find((m) => m.startsWith("e2e warm-up: / "));
    expect(line).toContain("(1 connection retry)");
    expect(goto).toHaveBeenCalledWith("/", expect.anything());
  });

  it("retries a dropped connection creating the session, silently (no line, no site count change)", async () => {
    const { goto, post, get, log, logError } = buildDeps("create-session");

    await runWarmUp({ goto, post, get, log, logError });

    const createCalls = post.mock.calls.filter((c) => c[0] === CREATE_SESSION_PATH);
    expect(createCalls).toHaveLength(2);
    expect(log).toHaveBeenCalledTimes(3);
    for (const [message] of log.mock.calls) {
      expect(message as string).not.toContain("connection retr");
    }
  });

  it("retries a dropped connection warming the session page and reports it", async () => {
    const { goto, post, get, log, logError } = buildDeps("session-page");

    await runWarmUp({ goto, post, get, log, logError });

    expect(log).toHaveBeenCalledTimes(3);
    const line = log.mock.calls
      .map((c) => c[0] as string)
      .find((m) => m.startsWith(`e2e warm-up: ${SESSION_PATH} `));
    expect(line).toContain("(1 connection retry)");
  });

  it("retries a dropped connection warming preview-export and reports it", async () => {
    const { goto, post, get, log, logError } = buildDeps("preview-export");

    await runWarmUp({ goto, post, get, log, logError });

    expect(log).toHaveBeenCalledTimes(3);
    const line = log.mock.calls
      .map((c) => c[0] as string)
      .find((m) => m.includes("/_agent-native/actions/preview-export"));
    expect(line).toContain("(1 connection retry)");
  });

  it("retries the cleanup delete-session without ever printing a line for it", async () => {
    const { goto, post, get, log, logError } = buildDeps("delete-session");

    await expect(runWarmUp({ goto, post, get, log, logError })).resolves.toBeUndefined();

    const deleteCalls = post.mock.calls.filter((c) => c[0] === DELETE_SESSION_PATH);
    expect(deleteCalls).toHaveLength(2);
    expect(log).toHaveBeenCalledTimes(3);
    for (const [message] of log.mock.calls) {
      expect(message as string).not.toContain(DELETE_SESSION_PATH);
      expect(message as string).not.toContain("connection retr");
    }
  });
});

describe("uses plural wording for two or more connection retries", () => {
  it("says '(2 connection retries)', not '(2 connection retry)'", async () => {
    let calls = 0;
    const answer = async () => {
      calls += 1;
      if (calls <= 2) throw new Error("read ECONNRESET");
      return 200;
    };
    const log = vi.fn();

    await warm("/", answer, log);

    expect(log).toHaveBeenCalledWith(expect.stringContaining("(2 connection retries)"));
    expect(log).not.toHaveBeenCalledWith(expect.stringContaining("(2 connection retry)"));
  });
});

describe("a dropped connection inside the 503 poll loop", () => {
  it("restarts the loop from its first page.goto, not from wherever it was interrupted", async () => {
    vi.useFakeTimers();
    try {
      let call = 0;
      const goto = vi.fn(async () => {
        call += 1;
        if (call === 1) return { status: () => STARTING_STATUS }; // first poll: still starting
        if (call === 2) throw new Error("read ECONNRESET"); // dropped mid-loop, on the second poll
        return { status: () => 200 }; // the restarted loop's own first call succeeds
      });
      const log = vi.fn();

      const promise = warm(SESSION_PATH, navigateStep(goto, SESSION_PATH), log);

      await vi.advanceTimersByTimeAsync(STARTING_RETRY_DELAY_MS); // the 503 poll's own wait
      await vi.advanceTimersByTimeAsync(CONNECTION_RETRY_DELAY_MS); // the connection-retry wait

      await promise;

      expect(goto).toHaveBeenCalledTimes(3);
      expect(log).toHaveBeenCalledTimes(1);
      expect(log.mock.calls[0]?.[0] as string).toContain("(1 connection retry)");
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("deadline exhaustion during a persistently dropped connection", () => {
  // A refused/reset connection fails almost instantly, so a deadline check made
  // only after a failure — right before the 500 ms wait — nearly always finds
  // time left, and the *wait itself* is what runs the clock out. These drive
  // the real `warm()` + step shapes through fake timers across the full
  // `WARM_UP_LIMIT_MS`, so they exercise exactly the call sites production
  // uses, not a shortened stand-in deadline.

  it("warm() + navigateStep report 'kept dropping the connection', never a bogus 503, for a persistently refused page navigation", async () => {
    vi.useFakeTimers();
    try {
      const goto = vi.fn(async () => {
        throw new Error("connect ECONNREFUSED 127.0.0.1:1234");
      });
      const log = vi.fn();

      const promise = warm(SESSION_PATH, navigateStep(goto, SESSION_PATH), log);
      const settled = promise.then(
        () => ({ ok: true as const }),
        (error: unknown) => ({ ok: false as const, error }),
      );

      await vi.advanceTimersByTimeAsync(WARM_UP_LIMIT_MS + 10_000);

      const result = await settled;
      expect(result.ok).toBe(false);
      if (!result.ok) {
        const message = (result.error as Error).message;
        expect(message).toContain("the server kept dropping the connection");
        expect(message).not.toContain("still starting");
      }
    } finally {
      vi.useRealTimers();
    }
  }, 20_000);

  it("warm() + a preview-export-shaped step report 'kept dropping the connection', not a clamped-timeout error", async () => {
    vi.useFakeTimers();
    try {
      const get = vi.fn(async (_path: string, opts: { timeout: number }): Promise<{ status(): number }> => {
        if (opts.timeout <= 1) throw new Error("Timeout 1ms exceeded");
        throw new Error("connect ECONNREFUSED 127.0.0.1:1234");
      });
      const log = vi.fn();
      const path = "/_agent-native/actions/preview-export?sessionId=demo";

      const promise = warm(
        path,
        async (deadline) => {
          const response = await get(path, { timeout: Math.max(deadline - Date.now(), 1) });
          return response.status();
        },
        log,
      );
      const settled = promise.then(
        () => ({ ok: true as const }),
        (error: unknown) => ({ ok: false as const, error }),
      );

      await vi.advanceTimersByTimeAsync(WARM_UP_LIMIT_MS + 10_000);

      const result = await settled;
      expect(result.ok).toBe(false);
      if (!result.ok) {
        const message = (result.error as Error).message;
        expect(message).toContain("the server kept dropping the connection");
        expect(message).not.toContain("Timeout 1ms exceeded");
      }
    } finally {
      vi.useRealTimers();
    }
  }, 20_000);

  it("wraps a persistently dropped connection creating the session in a full WarmUpError (URL, elapsed time, reason)", async () => {
    vi.useFakeTimers();
    try {
      const goto = vi.fn(async () => ({ status: () => 200 }));
      const post = vi.fn(async (path: string) => {
        if (path === CREATE_SESSION_PATH) {
          throw new Error("connect ECONNREFUSED 127.0.0.1:1234");
        }
        throw new Error(`unexpected post path ${path}`);
      });
      const get = vi.fn(async () => ({ status: () => 409 }));
      const log = vi.fn();
      const logError = vi.fn();

      const promise = runWarmUp({ goto, post, get, log, logError });
      const settled = promise.then(
        () => ({ ok: true as const }),
        (error: unknown) => ({ ok: false as const, error }),
      );

      await vi.advanceTimersByTimeAsync(WARM_UP_LIMIT_MS + 10_000);

      const result = await settled;
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toBeInstanceOf(WarmUpError);
        const message = (result.error as Error).message;
        expect(message).toContain(CREATE_SESSION_PATH);
        expect(message).toContain("the server kept dropping the connection");
        expect(message).toMatch(/after \d+ ms \(limit 180000 ms\)/);
      }
    } finally {
      vi.useRealTimers();
    }
  }, 20_000);

  it("wraps a persistently dropped connection during cleanup in a full WarmUpError when nothing else failed", async () => {
    vi.useFakeTimers();
    try {
      const goto = vi.fn(async () => ({ status: () => 200 }));
      const post = vi.fn(async (path: string) => {
        if (path === CREATE_SESSION_PATH) {
          return {
            ok: () => true,
            status: () => 200,
            text: async () => "",
            json: async () => ({ id: "session-1" }),
          };
        }
        if (path === DELETE_SESSION_PATH) {
          throw new Error("connect ECONNREFUSED 127.0.0.1:1234");
        }
        throw new Error(`unexpected post path ${path}`);
      });
      const get = vi.fn(async () => ({ status: () => 409 }));
      const log = vi.fn();
      const logError = vi.fn();

      const promise = runWarmUp({ goto, post, get, log, logError });
      const settled = promise.then(
        () => ({ ok: true as const }),
        (error: unknown) => ({ ok: false as const, error }),
      );

      await vi.advanceTimersByTimeAsync(WARM_UP_LIMIT_MS + 10_000);

      const result = await settled;
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toBeInstanceOf(WarmUpError);
        const message = (result.error as Error).message;
        expect(message).toContain(DELETE_SESSION_PATH);
        expect(message).toContain("the server kept dropping the connection");
      }
      // Nothing else failed, so this cleanup failure is the whole story: it
      // escapes rather than being swallowed and logged.
      expect(logError).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  }, 20_000);

  it("logs a cleanup failure through logError with a full message, not through log, once the main sequence already failed", async () => {
    vi.useFakeTimers();
    try {
      const goto = vi.fn(async (path: string) => {
        if (path === "/") return { status: () => 200 };
        return null; // session page: an instant, non-transient failure — no retry, no wait
      });
      const post = vi.fn(async (path: string) => {
        if (path === CREATE_SESSION_PATH) {
          return {
            ok: () => true,
            status: () => 200,
            text: async () => "",
            json: async () => ({ id: "session-1" }),
          };
        }
        if (path === DELETE_SESSION_PATH) {
          throw new Error("connect ECONNREFUSED 127.0.0.1:1234");
        }
        throw new Error(`unexpected post path ${path}`);
      });
      const get = vi.fn(async () => ({ status: () => 409 }));
      const log = vi.fn();
      const logError = vi.fn();

      const promise = runWarmUp({ goto, post, get, log, logError });
      const settled = promise.then(
        () => ({ ok: true as const }),
        (error: unknown) => ({ ok: false as const, error }),
      );

      await vi.advanceTimersByTimeAsync(WARM_UP_LIMIT_MS + 10_000);

      const result = await settled;
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect((result.error as Error).message).toContain("gave no response");
      }

      expect(logError).toHaveBeenCalledTimes(1);
      const cleanupMessage = logError.mock.calls[0]?.[0] as string;
      expect(cleanupMessage).toContain(DELETE_SESSION_PATH);
      expect(cleanupMessage).toContain("the server kept dropping the connection");
      for (const [loggedMessage] of log.mock.calls) {
        expect(loggedMessage as string).not.toContain(DELETE_SESSION_PATH);
      }
    } finally {
      vi.useRealTimers();
    }
  }, 20_000);
});
