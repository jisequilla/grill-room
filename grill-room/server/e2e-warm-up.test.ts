import { describe, expect, it, vi } from "vitest";

import {
  navigateStep,
  retryTransient,
  runWarmUp,
  STARTING_STATUS,
  warm,
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
      runWarmUp({ goto, post: vi.fn(), get: vi.fn(), log: vi.fn() }),
    ).rejects.toThrow(/gave no response/);
    expect(goto).toHaveBeenCalledTimes(1);
  });
});

type Site = "root" | "create-session" | "session-page" | "preview-export" | "delete-session" | "none";

function buildDeps(failingSite: Site) {
  const log = vi.fn();
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

  return { goto, post, get, log };
}

describe("runWarmUp", () => {
  it("prints exactly three warm-up lines, none retried, when nothing fails", async () => {
    const { goto, post, get, log } = buildDeps("none");

    await runWarmUp({ goto, post, get, log });

    expect(log).toHaveBeenCalledTimes(3);
    for (const [message] of log.mock.calls) {
      expect(message as string).not.toContain("connection retr");
    }
  });

  it("retries a dropped connection warming '/' and reports it, without changing the line count", async () => {
    const { goto, post, get, log } = buildDeps("root");

    await runWarmUp({ goto, post, get, log });

    expect(log).toHaveBeenCalledTimes(3);
    const line = log.mock.calls.map((c) => c[0] as string).find((m) => m.startsWith("e2e warm-up: / "));
    expect(line).toContain("(1 connection retry)");
    expect(goto).toHaveBeenCalledWith("/", expect.anything());
  });

  it("retries a dropped connection creating the session, silently (no line, no site count change)", async () => {
    const { goto, post, get, log } = buildDeps("create-session");

    await runWarmUp({ goto, post, get, log });

    const createCalls = post.mock.calls.filter((c) => c[0] === CREATE_SESSION_PATH);
    expect(createCalls).toHaveLength(2);
    expect(log).toHaveBeenCalledTimes(3);
    for (const [message] of log.mock.calls) {
      expect(message as string).not.toContain("connection retr");
    }
  });

  it("retries a dropped connection warming the session page and reports it", async () => {
    const { goto, post, get, log } = buildDeps("session-page");

    await runWarmUp({ goto, post, get, log });

    expect(log).toHaveBeenCalledTimes(3);
    const line = log.mock.calls
      .map((c) => c[0] as string)
      .find((m) => m.startsWith(`e2e warm-up: ${SESSION_PATH} `));
    expect(line).toContain("(1 connection retry)");
  });

  it("retries a dropped connection warming preview-export and reports it", async () => {
    const { goto, post, get, log } = buildDeps("preview-export");

    await runWarmUp({ goto, post, get, log });

    expect(log).toHaveBeenCalledTimes(3);
    const line = log.mock.calls
      .map((c) => c[0] as string)
      .find((m) => m.includes("/_agent-native/actions/preview-export"));
    expect(line).toContain("(1 connection retry)");
  });

  it("retries the cleanup delete-session without ever printing a line for it", async () => {
    const { goto, post, get, log } = buildDeps("delete-session");

    await expect(runWarmUp({ goto, post, get, log })).resolves.toBeUndefined();

    const deleteCalls = post.mock.calls.filter((c) => c[0] === DELETE_SESSION_PATH);
    expect(deleteCalls).toHaveLength(2);
    expect(log).toHaveBeenCalledTimes(3);
    for (const [message] of log.mock.calls) {
      expect(message as string).not.toContain(DELETE_SESSION_PATH);
      expect(message as string).not.toContain("connection retr");
    }
  });
});
