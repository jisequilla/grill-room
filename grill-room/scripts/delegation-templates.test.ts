import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { repoPath } from "../test/repo-root.js";

const BUILDER = readFileSync(
  repoPath(".claude/templates/delegation/builder.md"),
  "utf8",
);

const EVIDENCE_BULLET =
  '- `## Evidence`: one entry per numbered acceptance line. Each entry gives the acceptance number, the test file and test name, the source ranges the test covers (written as under "Evidence ranges" below), the quoted red run and the quoted green run. For a test-only PR, the entry quotes that line from the Revert block and gives the covered ranges. For a UI change, it also names the absolute folder of the screenshots and the exact command that regenerates them.';

const EXPECTED_ROWS: Array<[string, boolean]> = [
  ["grill-room/server/a.ts:10-20", true],
  ["grill-room/server/a.ts:7-7", true],
  ["grill-room/server/a.ts:10-20,grill-room/server/a.ts:40-52", true],
  [".claude/workflows/ticket-build-review-loop.js:102-107", true],
  ["grill-room/server/a.ts:7", false],
  ["brief-grounding.ts:701-705", false],
  [":663-667", false],
  ["grill-room/x.ts:1-5,9-12", false],
  ["/Users/me/repo/grill-room/x.ts:1-5", false],
];

const RANGE_PIECE = /^(?:[^/\s,:]+\/)+[^/\s,:]+:\d+-\d+$/;
const PREFER_ARGUMENT = /^(.+):(\d+)-(\d+)$/;

const parseRows = (): Array<[string, boolean]> =>
  BUILDER.split("\n").flatMap((line) => {
    const m = /^\| `([^`]+)` \| (yes|no) \|$/.exec(line);
    return m ? [[m[1], m[2] === "yes"] as [string, boolean]] : [];
  });

const accepted = (range: string): boolean =>
  range.split(",").every((piece) => RANGE_PIECE.test(piece));

describe("builder.md", () => {
  it("the Evidence bullet", () => {
    const bullet = BUILDER.split("\n").find((l) =>
      l.startsWith("- `## Evidence`"),
    );
    expect(bullet).toBe(EVIDENCE_BULLET);
  });

  it("the Evidence ranges table", () => {
    expect(BUILDER).toContain("### Evidence ranges");
    expect(parseRows()).toEqual(EXPECTED_ROWS);
  });

  it("each row of the Evidence ranges table agrees with the range check", () => {
    const rows = parseRows();
    expect(rows).toHaveLength(9);
    for (const [range, flag] of rows) {
      expect({ range, accepted: accepted(range) }).toEqual({
        range,
        accepted: flag,
      });
    }
  });

  it("accepted ranges survive the Mutate prompt's prefix strip", () => {
    const rows = parseRows();
    expect(rows).toHaveLength(9);
    const candidates = rows.filter(
      ([range, flag]) => flag && range.startsWith("grill-room/"),
    );
    expect(candidates.length).toBeGreaterThan(0);
    for (const [range] of candidates) {
      for (const piece of range.split(",")) {
        const stripped = piece.replace(/^grill-room\//, "");
        expect(stripped).toMatch(PREFER_ARGUMENT);
        expect(stripped.startsWith("grill-room/")).toBe(false);
      }
    }
  });

  it("placeholders", () => {
    const found = new Set(BUILDER.match(/\{\{\s*\w+\s*\}\}/g) ?? []);
    for (const p of found) {
      expect(["{{bead}}", "{{title}}", "{{ticket}}"]).toContain(
        p.replace(/\s/g, ""),
      );
    }
  });
});
