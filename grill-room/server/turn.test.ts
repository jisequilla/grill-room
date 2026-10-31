import { describe, expect, it } from "vitest";

import { portAnswerKind } from "./turn.js";

describe("portAnswerKind", () => {
  it("spells a dispositioned row as its target", () => {
    const dispositioned = (dispositionTarget: "out-of-scope" | "open-question" | "builders-call") =>
      portAnswerKind({ answerKind: "dispositioned", dispositionTarget });

    expect(dispositioned("out-of-scope")).toBe("out-of-scope");
    expect(dispositioned("open-question")).toBe("open-question");
    expect(dispositioned("builders-call")).toBe("builders-call");
  });
});
