import { resolveConfig } from "vite";
import { describe, expect, it } from "vitest";

import { repoPath } from "./repo-root.js";

const resolveDevConfig = async () => {
  const before = { ...process.env };
  process.env.IS_RR_BUILD_REQUEST = "yes";
  try {
    return await resolveConfig(
      {
        configFile: repoPath("grill-room", "vite.config.ts"),
        root: repoPath("grill-room"),
      },
      "serve",
      "development",
    );
  } finally {
    for (const key of Object.keys(process.env)) {
      if (!(key in before)) delete process.env[key];
    }
    Object.assign(process.env, before);
  }
};

describe("dev server host", () => {
  it("the dev server binds 127.0.0.1 only", async () => {
    const config = await resolveDevConfig();
    expect(config.server.host).toBe("127.0.0.1");
  }, 60_000);

  it("resolving the config leaves process.env as it found it", async () => {
    const snapshot = { ...process.env };
    await resolveDevConfig();
    expect(process.env).toEqual(snapshot);
  }, 60_000);
});
