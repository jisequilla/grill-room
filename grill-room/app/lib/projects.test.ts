import { describe, expect, it } from "vitest";

import messages from "@/i18n/en-US";
import { PROJECT_ERROR } from "@/lib/projects";

function message(key: string): unknown {
  return key
    .split(".")
    .reduce<unknown>(
      (node, part) => (node as Record<string, unknown> | undefined)?.[part],
      messages,
    );
}

describe("PROJECT_ERROR", () => {
  it.each([
    ["durable-folder-required", ["durableExportFolder"]],
    ["durable-folder-outside-root", ["durableExportFolder"]],
    ["durable-folder-is-root", ["durableExportFolder"]],
    ["export-folder-required", ["workingExportFolder"]],
    ["export-folder-outside-root", ["workingExportFolder"]],
    ["export-folder-is-root", ["workingExportFolder"]],
    ["export-roots-overlap", ["durableExportFolder", "workingExportFolder"]],
  ])("shows %s under exactly %j", (code, fields) => {
    expect(PROJECT_ERROR[code]?.fields).toEqual(fields);
  });

  it("names a sentence that exists for every code", () => {
    for (const [code, { key }] of Object.entries(PROJECT_ERROR)) {
      expect({ code, text: typeof message(key) }).toEqual({ code, text: "string" });
    }
  });
});
