import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";

import { repoPath } from "../test/repo-root.js";
import { RUN_BUDGET_MS } from "./mutate-diff.js";

const loadConfig = async () =>
  (await import(pathToFileURL(repoPath("grill-room/stryker.config.mjs")).href))
    .default as Record<string, unknown>;

describe("stryker config", () => {
  it("dryRunTimeoutMinutes covers the mutation run budget", async () => {
    const config = await loadConfig();
    expect(config.dryRunTimeoutMinutes).toBe(Math.ceil(RUN_BUDGET_MS / 60000));
  });

  it("the dry run can use the whole budget", async () => {
    const config = await loadConfig();
    expect(
      (config.dryRunTimeoutMinutes as number) * 60000 >= RUN_BUDGET_MS,
    ).toBe(true);
  });

  it("every config key is a Stryker option", async () => {
    const config = await loadConfig();
    const schema = JSON.parse(
      readFileSync(
        repoPath(
          "grill-room/node_modules/@stryker-mutator/core/schema/stryker-schema.json",
        ),
        "utf8",
      ),
    ) as { properties: Record<string, unknown> };
    expect(
      Object.keys(config).filter((key) => !(key in schema.properties)),
    ).toEqual([]);
  });
});
