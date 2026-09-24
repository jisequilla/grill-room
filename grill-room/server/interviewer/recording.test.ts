import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { createFakeInterviewer, fakeScenarios } from "./fake.js";
import { loadRecording, registerRecording } from "./recording.js";
import {
  aFindSupersededRequest,
  aFindSupersededResult,
  aProposeRoundRequest,
  aProposeRoundResult,
} from "./test-fixtures.js";

/**
 * The loader that turns a recording file into a `Scenario`. Mirrors the
 * shape the real adapter's recording mode writes: one JSON line per accepted
 * turn, `{ kind, result }`.
 */

async function tempRecordingFile(): Promise<{ dir: string; file: string }> {
  const dir = await mkdtemp(path.join(tmpdir(), "grill-room-recording-load-"));
  return { dir, file: path.join(dir, "recording.jsonl") };
}

async function writeRecording(
  file: string,
  entries: Array<{ kind: string; result: unknown } | string>,
): Promise<void> {
  const lines = entries.map((entry) =>
    typeof entry === "string" ? entry : JSON.stringify(entry),
  );
  await writeFile(file, `${lines.join("\n")}\n`, "utf8");
}

describe("loading a recording", () => {
  it("becomes a scenario whose turns replay in the file's order", async () => {
    const { dir, file } = await tempRecordingFile();
    try {
      await writeRecording(file, [
        { kind: "propose-round", result: aProposeRoundResult() },
        { kind: "find-superseded", result: aFindSupersededResult() },
      ]);

      const scenario = await loadRecording(file);

      expect(scenario).toEqual({
        turns: [
          { kind: "propose-round", result: aProposeRoundResult() },
          { kind: "find-superseded", result: aFindSupersededResult() },
        ],
      });

      // The scenario is a real, playable script, not just a matching shape.
      const interviewer = createFakeInterviewer(scenario.turns);
      expect(
        (await interviewer.proposeRound(aProposeRoundRequest())).result,
      ).toEqual(aProposeRoundResult());
      expect(
        (await interviewer.findSuperseded(aFindSupersededRequest())).result,
      ).toEqual(aFindSupersededResult());
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("skips blank lines", async () => {
    const { dir, file } = await tempRecordingFile();
    try {
      await writeFile(
        file,
        [
          "",
          JSON.stringify({ kind: "propose-round", result: aProposeRoundResult() }),
          "   ",
          "",
        ].join("\n"),
        "utf8",
      );

      const scenario = await loadRecording(file);

      expect(scenario.turns).toEqual([
        { kind: "propose-round", result: aProposeRoundResult() },
      ]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("refuses the whole file on the first line that is not valid JSON, naming the line", async () => {
    const { dir, file } = await tempRecordingFile();
    try {
      await writeRecording(file, [
        { kind: "propose-round", result: aProposeRoundResult() },
        "not json at all",
      ]);

      await expect(loadRecording(file)).rejects.toThrow(/line 2.*not valid JSON/is);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("refuses a line naming a kind with no schema, naming the line", async () => {
    const { dir, file } = await tempRecordingFile();
    try {
      await writeRecording(file, [
        { kind: "propose-round", result: aProposeRoundResult() },
        { kind: "made-up-kind", result: {} },
      ]);

      await expect(loadRecording(file)).rejects.toThrow(
        /line 2.*unknown request kind/is,
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("refuses a line whose result fails its kind's schema, naming the line", async () => {
    const { dir, file } = await tempRecordingFile();
    try {
      await writeRecording(file, [
        { kind: "propose-round", result: aProposeRoundResult() },
        { kind: "propose-round", result: { proposedDecisions: "not a list" } },
      ]);

      await expect(loadRecording(file)).rejects.toThrow(
        /line 2.*"propose-round".*does not match its schema/is,
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("refuses a line that is not a { kind, result } object, naming the line", async () => {
    const { dir, file } = await tempRecordingFile();
    try {
      await writeRecording(file, [{ kind: "propose-round", result: aProposeRoundResult() }, "null"]);
      // "null" parses as valid JSON but is not an object with kind/result.

      await expect(loadRecording(file)).rejects.toThrow(/line 2/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("registering a recording as a scenario", () => {
  const REGISTERED_NAME = "recording-test-scenario";

  afterEach(() => {
    delete fakeScenarios[REGISTERED_NAME];
  });

  it("loads and registers the recording under the given name in one call", async () => {
    const { dir, file } = await tempRecordingFile();
    try {
      await writeRecording(file, [
        { kind: "propose-round", result: aProposeRoundResult() },
      ]);

      await registerRecording(REGISTERED_NAME, file);

      expect(fakeScenarios[REGISTERED_NAME]).toEqual({
        turns: [{ kind: "propose-round", result: aProposeRoundResult() }],
      });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("registers nothing when the recording is invalid", async () => {
    const { dir, file } = await tempRecordingFile();
    try {
      await writeRecording(file, ["not json"]);

      await expect(registerRecording(REGISTERED_NAME, file)).rejects.toThrow();

      expect(fakeScenarios[REGISTERED_NAME]).toBeUndefined();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
