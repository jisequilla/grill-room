import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { specRefusalReasons } from "../../actions/synthesize-spec.js";

const DEMO_RECORDING_PATH = fileURLToPath(
  new URL("../../e2e/fixtures/demo-recording.jsonl", import.meta.url),
);

describe("demo recording", () => {
  it("every synthesize-spec turn passes the spec check", () => {
    const turns = readFileSync(DEMO_RECORDING_PATH, "utf8")
      .split("\n")
      .filter((line) => line.trim() !== "")
      .map(
        (line) =>
          JSON.parse(line) as { kind: string; result: { markdown: string } },
      )
      .filter((turn) => turn.kind === "synthesize-spec");

    expect(turns.length).toBeGreaterThan(0);
    for (const turn of turns) {
      expect(specRefusalReasons(turn.result.markdown)).toEqual([]);
    }
  });
});
