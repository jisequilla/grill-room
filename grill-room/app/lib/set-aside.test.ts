import { describe, expect, it } from "vitest";

import { moveTargets } from "./set-aside";

describe("moveTargets", () => {
  it("lists the other two targets, in order", () => {
    expect(moveTargets("out-of-scope")).toEqual(["open-question", "builders-call"]);
    expect(moveTargets("open-question")).toEqual(["out-of-scope", "builders-call"]);
    expect(moveTargets("builders-call")).toEqual(["out-of-scope", "open-question"]);
  });
});
