import { describe, expect, it } from "vitest";

import { useTestDatabase } from "../test/db.js";
import getDefaultModel from "./get-default-model.js";
import setDefaultModel from "./set-default-model.js";

describe("global default model actions", () => {
  useTestDatabase();

  it("falls back to fable when the default model was never set", async () => {
    expect(await getDefaultModel.run({})).toEqual({ model: "fable" });
  });

  it("reads back a default model that was set", async () => {
    await setDefaultModel.run({ model: "opus" });

    expect(await getDefaultModel.run({})).toEqual({ model: "opus" });
  });

  it("replaces an existing default model instead of failing or duplicating", async () => {
    await setDefaultModel.run({ model: "opus" });
    await setDefaultModel.run({ model: "sonnet" });

    expect(await getDefaultModel.run({})).toEqual({ model: "sonnet" });
  });
});
